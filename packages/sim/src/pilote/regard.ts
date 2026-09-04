/**
 * Lire le plateau à travers la vue publique.
 *
 * Contrainte de fond, et raison d'être de ce fichier : **un bot ne voit que
 * ce qu'un joueur voit**. Il n'a ni `Board`, ni `GameState`, seulement la vue
 * publique et sa vue privée, exactement comme le navigateur d'un invité. Tout
 * ce qui suit se déduit donc de ces deux objets — et de la géométrie, qui est
 * publique par construction : un sommet **est** le trio d'hexagones qui s'y
 * rejoignent (voir `board/graph.ts`), son identifiant le dit, il n'y a rien à
 * demander au serveur pour savoir ce qu'il produit.
 *
 * C'est ce qui permet de rendre les adversaires nettement plus forts sans
 * leur ouvrir le moindre raccourci : ils ne trichent pas davantage qu'avant,
 * ils regardent enfin ce qu'ils avaient sous les yeux.
 */

import type { PublicGameView, PublicHex, PublicPlayer } from '@grandes-colonies/protocol';
import {
  type Axial,
  type PlayerId,
  type Resource,
  type ResourceCounts,
  type VertexId,
  RESOURCES,
  addCounts,
  amount,
  counts,
  adjacentVertices,
  hexKey,
  hexesOfVertex,
  parseHexKey,
  verticesOfEdge,
  vertexIdsOfHex,
  yieldOf,
} from '@grandes-colonies/engine';

/**
 * Ce que vaut un jeton, en trente-sixièmes.
 *
 * Les pastilles de Catan, à un détail près qui n'est pas un détail ici : le
 * §6 double la production du 2 et du 12. Un 12 produit une fois sur trente-
 * six mais rapporte deux cartes, ce qui le remet au niveau du 3 — et un bot
 * qui l'ignore sous-évalue précisément les emplacements que la règle
 * cherchait à rendre attractifs.
 */
export function poidsJeton(token: number | undefined): number {
  if (token === undefined) return 0;
  const pastilles = 6 - Math.abs(7 - token);
  if (pastilles <= 0) return 0;
  return token === 2 || token === 12 ? pastilles * 2 : pastilles;
}

/**
 * Ce que vaut une ressource pour construire, indépendamment de la partie.
 *
 * Les cinq de base ne se valent pas : le blé entre dans quatre coûts sur
 * sept, le bois dans trois, l'or dans un seul. L'or reste néanmoins désirable
 * parce que la métropole vaut trois points — mais il ne fait pas vivre une
 * partie à lui seul, et un bot qui s'installerait sur deux tuiles d'or n'y
 * bâtirait jamais rien.
 */
const UTILITE: Readonly<Record<Resource, number>> = Object.freeze({
  grain: 1.15, ore: 1.05, brick: 1, wood: 1, wool: 0.85, gold: 0.7, fish: 0.25,
});

/**
 * La géométrie du plateau, calculée une fois pour toute la partie.
 *
 * Un identifiant de sommet est une chaîne — trois clés d'hexagones collées —
 * et l'ouvrir coûte une découpe et six conversions de nombres. C'est
 * anodin une fois ; ça ne l'est plus quand douze adversaires évaluent trois
 * cents sommets à chaque message reçu, et la mesure était sans appel : sept
 * fois le temps d'une partie simulée passait là.
 *
 * Le plateau ne bouge pas de la partie : le cache n'a donc jamais à être
 * invalidé, et il vit aussi longtemps que le pilote qui le porte.
 */
export class Atlas {
  private readonly hexesParSommet = new Map<VertexId, Axial[]>();
  private readonly voisinsParSommet = new Map<VertexId, VertexId[]>();
  private readonly sommetsParArete = new Map<string, VertexId[]>();
  private sommets: VertexId[] | undefined;

  hexesDuSommet(vertex: VertexId): Axial[] {
    let out = this.hexesParSommet.get(vertex);
    if (out === undefined) { out = hexesOfVertex(vertex); this.hexesParSommet.set(vertex, out); }
    return out;
  }

  voisinsDuSommet(vertex: VertexId): VertexId[] {
    let out = this.voisinsParSommet.get(vertex);
    if (out === undefined) { out = adjacentVertices(vertex); this.voisinsParSommet.set(vertex, out); }
    return out;
  }

  sommetsDeLArete(edge: string): VertexId[] {
    let out = this.sommetsParArete.get(edge);
    if (out === undefined) { out = verticesOfEdge(edge); this.sommetsParArete.set(edge, out); }
    return out;
  }

  /** Tous les sommets du plateau, dans l'ordre où les hexagones les donnent. */
  tousLesSommets(hexes: Iterable<string>): VertexId[] {
    if (this.sommets) return this.sommets;
    const vus = new Set<VertexId>();
    for (const id of hexes) {
      for (const vertex of vertexIdsOfHex(parseHexKey(id))) vus.add(vertex);
    }
    this.sommets = [...vus];
    return this.sommets;
  }
}

/** La vue publique remise en tables, pour ne pas la reparcourir mille fois. */
export class Lecture {
  readonly hexes: ReadonlyMap<string, PublicHex>;
  readonly batiments: ReadonlyMap<VertexId, { kind: string; owner: PlayerId }>;
  readonly ports: ReadonlyMap<VertexId, string>;
  readonly joueurs: ReadonlyMap<PlayerId, PublicPlayer>;
  private libres: Set<VertexId> | undefined;
  private readonly production = new Map<VertexId, ResourceCounts>();
  private readonly revenus = new Map<PlayerId, ResourceCounts>();
  private readonly territoires = new Map<PlayerId, Map<string, number>>();

  constructor(readonly vue: PublicGameView, readonly atlas: Atlas = new Atlas()) {
    const hexes = new Map<string, PublicHex>();
    for (const hex of vue.hexes) hexes.set(hex.id, hex);
    this.hexes = hexes;

    const batiments = new Map<VertexId, { kind: string; owner: PlayerId }>();
    for (const b of vue.buildings) batiments.set(b.vertex, { kind: b.kind, owner: b.owner });
    this.batiments = batiments;

    const ports = new Map<VertexId, string>();
    for (const p of vue.ports) ports.set(p.vertex, p.kind);
    this.ports = ports;

    const joueurs = new Map<PlayerId, PublicPlayer>();
    for (const p of vue.players) joueurs.set(p.id, p);
    this.joueurs = joueurs;
  }

  /**
   * Les sommets encore constructibles, règle de distance comprise.
   *
   * La vue privée ne donne les emplacements qu'aux joueurs qui peuvent
   * *payer* — c'est une économie voulue côté serveur, mais elle laisse un
   * bot fauché sans aucune idée d'où il irait. Or la règle de distance est
   * de la pure géométrie, et la position des bâtiments est publique : on la
   * refait donc ici, ce qui n'apprend rien que la table ne sache déjà.
   *
   * Cette liste ignore la connexion au réseau de routes : elle sert à
   * évaluer *vers où* aller, pas à décider où poser — pour poser, seuls les
   * emplacements donnés par le serveur font foi.
   */
  sitesLibres(): ReadonlySet<VertexId> {
    if (this.libres) return this.libres;
    const libres = new Set<VertexId>();
    for (const vertex of this.atlas.tousLesSommets(this.hexes.keys())) {
      if (this.batiments.has(vertex)) continue;
      if (this.atlas.voisinsDuSommet(vertex).some((v) => this.batiments.has(v))) continue;
      libres.add(vertex);
    }
    this.libres = libres;
    return libres;
  }

  /** Les hexagones du plateau qui touchent ce sommet — un à trois. */
  hexesDuSommet(vertex: VertexId): PublicHex[] {
    const out: PublicHex[] = [];
    for (const axial of this.atlas.hexesDuSommet(vertex)) {
      const hex = this.hexes.get(hexKey(axial));
      if (hex) out.push(hex);
    }
    return out;
  }

  /**
   * Ce qu'une colonie posée là rapporterait par tour, en trente-sixièmes.
   *
   * Un hexagone bloqué par le voleur compte pour rien : c'est temporaire,
   * mais c'est vrai au moment où l'on choisit, et à douze joueurs il y a deux
   * voleurs sur la carte.
   */
  productionDuSommet(vertex: VertexId): ResourceCounts {
    const connu = this.production.get(vertex);
    if (connu) return connu;
    let out: ResourceCounts = {};
    for (const hex of this.hexesDuSommet(vertex)) {
      const resource = yieldOf(hex.terrain);
      if (resource === null) continue;
      const poids = hex.blocked ? 0 : poidsJeton(hex.token);
      if (poids === 0) continue;
      out = addCounts(out, counts({ [resource]: poids }));
    }
    this.production.set(vertex, out);
    return out;
  }

  /** Le revenu total d'un joueur, colonies et villes confondues. */
  revenuDe(playerId: PlayerId): ResourceCounts {
    const connu = this.revenus.get(playerId);
    if (connu) return connu;
    let out: ResourceCounts = {};
    for (const [vertex, batiment] of this.batiments) {
      if (batiment.owner !== playerId) continue;
      const facteur = batiment.kind === 'settlement' ? 1 : 2;
      const production = this.productionDuSommet(vertex);
      for (const r of RESOURCES) {
        const n = amount(production, r) * facteur;
        if (n > 0) out = addCounts(out, counts({ [r]: n }));
      }
    }
    this.revenus.set(playerId, out);
    return out;
  }

  /** Les hexagones qui alimentent un joueur, avec ce qu'ils lui rapportent. */
  hexesDe(playerId: PlayerId): Map<string, number> {
    const connu = this.territoires.get(playerId);
    if (connu) return connu;
    const out = new Map<string, number>();
    for (const [vertex, batiment] of this.batiments) {
      if (batiment.owner !== playerId) continue;
      const facteur = batiment.kind === 'settlement' ? 1 : 2;
      for (const axial of this.atlas.hexesDuSommet(vertex)) {
        const id = hexKey(axial);
        const hex = this.hexes.get(id);
        if (!hex || yieldOf(hex.terrain) === null) continue;
        out.set(id, (out.get(id) ?? 0) + poidsJeton(hex.token) * facteur);
      }
    }
    this.territoires.set(playerId, out);
    return out;
  }

  /**
   * Le joueur en tête, hors soi-même.
   *
   * Les points publics font foi : l'objectif secret ne se voit pas, et c'est
   * très bien — un bot qui viserait le meneur réel saurait quelque chose
   * qu'aucun joueur ne sait.
   */
  meneur(sauf: PlayerId): PublicPlayer | undefined {
    let best: PublicPlayer | undefined;
    for (const p of this.vue.players) {
      if (p.id === sauf) continue;
      if (best === undefined || p.publicPoints > best.publicPoints) best = p;
    }
    return best;
  }

  /** Le joueur qui tient le plus de cartes, hors soi-même. */
  plusRiche(sauf: PlayerId): PublicPlayer | undefined {
    let best: PublicPlayer | undefined;
    for (const p of this.vue.players) {
      if (p.id === sauf) continue;
      if (best === undefined || p.handSize > best.handSize) best = p;
    }
    return best;
  }

  /** Combien la table entière détient de cette ressource, hors soi-même. */
  circulation(resource: Resource, sauf: PlayerId): number {
    let n = 0;
    for (const p of this.vue.players) {
      if (p.id === sauf) continue;
      n += amount(p.hand, resource);
    }
    return n;
  }
}

/**
 * Ce que vaut un emplacement de colonie.
 *
 * Quatre termes, dans l'ordre de ce qui décide vraiment d'une partie :
 *
 *   — la **production**, pondérée par l'utilité de chaque ressource et par
 *     ce qui manque déjà au joueur ;
 *   — la **diversité**, parce que trois tuiles de bois sur un même sommet
 *     obligent à tout convertir au cours fort ;
 *   — le **port**, qui vaut d'autant plus que le §10 fait monter les cours ;
 *   — la **rareté**, ce que l'emplacement retire aux autres : un sommet
 *     médiocre mais unique sur une île vaut mieux qu'un bon sommet là où il
 *     en reste dix.
 *
 * `besoin` est la pénurie ressentie par le joueur, de 0 à 1 par ressource :
 * elle penche l'évaluation vers ce qui lui manque sans jamais l'y enfermer.
 */
export function valeurDuSommet(
  lecture: Lecture,
  vertex: VertexId,
  besoin: Readonly<Partial<Record<Resource, number>>> = {},
  options: { readonly maritime?: number } = {},
): number {
  const production = lecture.productionDuSommet(vertex);

  let rendement = 0;
  let natures = 0;
  for (const r of RESOURCES) {
    const poids = amount(production, r);
    if (poids === 0) continue;
    natures++;
    rendement += poids * UTILITE[r] * (1 + (besoin[r] ?? 0));
  }

  // La diversité se paie en cartes économisées au marché : deux natures
  // valent mieux qu'une seule deux fois plus grosse.
  const diversite = natures >= 3 ? 4 : natures === 2 ? 2 : 0;

  const port = lecture.ports.get(vertex);
  // Un port à contrat (§11) ne remise pas le cours, il s'y soustrait : à deux
  // cartes pour une quoi qu'il arrive, il vaut plus cher qu'un port ordinaire
  // dès que le marché s'emballe.
  const valeurPort = port === undefined ? 0
    : port === 'commercial' || port === 'mining' ? 5
    : port === 'merchant' ? 4
    : port === 'generic' ? 2.5 : 3;

  // Sur la mer, un sommet qui touche peu de terres reste une tête de pont :
  // c'est par lui qu'on atteindra l'île voisine.
  const mer = lecture.hexesDuSommet(vertex).filter((h) => h.terrain === 'sea').length;
  const large = mer > 0 ? (options.maritime ?? 0) * mer * 1.5 : 0;

  return rendement + diversite + valeurPort + large;
}

/**
 * Ce qu'il manque le plus au joueur, de 0 à 1 par ressource.
 *
 * Deux sources : ce qu'il a en main maintenant, et ce que son plateau lui
 * donnera ensuite. La seconde compte davantage — une main se refait en un
 * lancer, un revenu se paie en colonies.
 */
export function besoinsDe(
  main: ResourceCounts,
  revenu: ResourceCounts,
): Partial<Record<Resource, number>> {
  const out: Partial<Record<Resource, number>> = {};
  let revenuMax = 0;
  for (const r of RESOURCES) revenuMax = Math.max(revenuMax, amount(revenu, r));

  for (const r of RESOURCES) {
    if (r === 'fish') continue;
    const parLeSol = revenuMax === 0 ? 1 : 1 - amount(revenu, r) / revenuMax;
    const enMain = amount(main, r) === 0 ? 1 : amount(main, r) <= 1 ? 0.5 : 0;
    out[r] = Math.min(1, parLeSol * 0.7 + enMain * 0.3);
  }
  return out;
}

/**
 * Ce que vaut une arête, pour une route.
 *
 * Une route ne rapporte rien par elle-même : elle vaut ce que valent les
 * emplacements qu'elle ouvre, et un peu ce qu'elle allonge — la plus longue
 * route pèse deux points, et c'est le seul titre qu'on gagne en construisant
 * ce qu'on construirait de toute façon.
 */
export function valeurDeLArete(
  lecture: Lecture,
  edge: string,
  besoin: Readonly<Partial<Record<Resource, number>>>,
  aVenir: ReadonlySet<VertexId>,
): number {
  let best = 0;
  for (const vertex of lecture.atlas.sommetsDeLArete(edge)) {
    if (lecture.batiments.has(vertex)) continue;
    const ouvre = aVenir.has(vertex) ? 1.4 : 1;
    best = Math.max(best, valeurDuSommet(lecture, vertex, besoin) * ouvre);
  }
  return best;
}
