/**
 * Le pilote — un adversaire complet, qui ne voit que ce qu'un joueur voit.
 *
 * Il prend la vue publique et sa vue privée, et rend **une** commande : la
 * prochaine qu'il jouerait. Rien d'autre n'entre, rien d'autre ne sort. C'est
 * cette contrainte qui donne au fichier sa forme — chaque décision se prend
 * avec l'information d'un joueur assis à la table, et jamais avec l'état du
 * moteur, qu'aucun invité n'a sous les yeux.
 *
 * Elle a aussi une conséquence agréable : le même pilote sert au bot réseau
 * de `scripts/bots.ts` et au simulateur de `packages/sim`. Ce qu'on mesure en
 * dix mille parties est exactement ce qui s'assoit à la table le soir venu.
 *
 * L'ordre des étapes ci-dessous n'est pas décoratif : il va de ce qui bloque
 * la partie (une défausse due, un voleur à déplacer) vers ce qui la fait
 * avancer (construire), puis vers ce qui la fait vivre (proposer, annoncer).
 * Un bot qui négocierait avant de lancer les dés ferait attendre onze
 * personnes.
 */

import type { PrivatePlayerView, PublicGameView, PublicOffer } from '@grand-colonies/protocol';
import {
  type Command,
  type IntentTarget,
  type ObjectiveId,
  type PlayerId,
  type Resource,
  type ResourceCounts,
  type VertexId,
  CORE_RESOURCES,
  COSTS,
  DEFAULT_MINIMUM_KNIGHTS,
  RESOURCES,
  SeededRandom,
  addCounts,
  amount,
  canAfford,
  counts,
  missingFor,
  subtractCounts,
  total,
} from '@grand-colonies/engine';

import type { Caractere } from './caractere.js';
import type { Niveau } from './niveau.js';
import { type But, butDeFin, choisirLeBut } from './plan.js';
import { Lecture, besoinsDe, valeurDeLArete, valeurDuSommet } from './regard.js';

/** Une commande sans son en-tête : l'appelant y ajoute qui joue et quand. */
type SansEnTete<T> = T extends unknown ? Omit<T, 'actionId' | 'playerId'> : never;
export type Coup = SansEnTete<Command>;

export interface Profil {
  readonly niveau: Niveau;
  readonly caractere: Caractere;
  /** Graine du hasard propre à ce bot : deux parties identiques se rejouent. */
  readonly graine: string;
  /**
   * Le pilote clôt-il lui-même ses tours ?
   *
   * Vrai pour le bot réseau, qui est seul à savoir qu'il n'a plus rien à
   * faire. Faux en simulation, où le runner ferme les tours lui-même : les
   * deux le feraient sinon, et le second échouerait à chaque fois.
   */
  readonly conclut: boolean;
}

/**
 * Ce que le caractère cherche dans un objectif secret (§21).
 *
 * Deux points valent une ville : un objectif choisi au hasard, c'est une
 * ville perdue. Et le choisir en accord avec son caractère fait plus que
 * rapporter — il rend le bot lisible, parce qu'il jouera dans ce sens.
 */
const AFFINITES: Readonly<Record<ObjectiveId, (c: Caractere) => number>> = {
  architect: (c) => c.traits.expansion * 1.1,
  urbanist: (c) => c.traits.developpement,
  settler: (c) => c.traits.expansion,
  roadNetwork: (c) => c.traits.expansion * 0.8 + c.traits.marine * 0.5,
  warlord: (c) => c.traits.agression * 0.9 + c.traits.cartes * 0.4,
  explorer: (c) => c.traits.marine,
  magnate: (c) => c.traits.developpement * 0.5,
  diplomat: (c) => c.traits.commerce,
  merchant: (c) => c.traits.commerce * 0.8 + c.traits.marine * 0.4,
};

export class Pilote {
  private readonly rng: SeededRandom;
  /** Cycle en cours d'observation, pour remettre les compteurs à zéro. */
  private cycleVu = -1;
  private offresDuCycle = 0;
  private annonceDuCycle = -1;
  /** Dernière offre proposée, pour ne jamais la reposter à l'identique. */
  private derniereOffre = '';

  constructor(readonly profil: Profil) {
    this.rng = new SeededRandom(profil.graine);
  }

  get niveau(): Niveau { return this.profil.niveau; }
  get traits(): Caractere['traits'] { return this.profil.caractere.traits; }

  /** Le temps que ce bot laisse passer avant de jouer, en millisecondes. */
  reflexion(): number {
    const [min, max] = this.niveau.reflexionMs;
    return min + this.rng.next() * (max - min);
  }

  /**
   * Un tirage entre 0 et 1, **reproductible dans un même état**.
   *
   * C'est la clé de la stabilité promise par `decider`. Un générateur à flux
   * — même seedé — rendrait deux valeurs différentes à deux appels
   * consécutifs, et le bot changerait d'avis entre deux messages reçus sans
   * que rien n'ait bougé sur le plateau : le garde-fou de `scripts/bots.ts`,
   * qui compare la commande à la précédente, ne verrait jamais deux fois la
   * même et le bot mitraillerait des variantes de la même idée.
   *
   * Le tirage dépend donc de ce qui identifie la situation — le bot, le
   * cycle, la décision en cours, le rang du candidat — et de rien d'autre.
   * Il varie d'un cycle à l'autre, d'un bot à l'autre et d'une décision à
   * l'autre ; il ne varie pas entre deux appels dans le même état.
   */
  private tirage(quoi: string, rang = 0): number {
    let h = 0x811c9dc5;
    const cle = `${this.profil.graine}|${this.cycleVu}|${quoi}|${rang}`;
    for (let i = 0; i < cle.length; i++) {
      h ^= cle.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
  }

  /**
   * La prochaine commande, ou rien si le bot n'a plus la main.
   *
   * Appelée en boucle — à chaque message reçu du serveur, plusieurs fois par
   * seconde. Elle est donc **stable** : deux appels dans le même état rendent
   * le même coup, sinon un bot inonderait la partie de variantes de la même
   * idée et le garde-fou de `scripts/bots.ts`, qui compare la commande à la
   * précédente, ne verrait jamais deux fois la même.
   *
   * Une exception, voulue : une offre d'échange n'est proposée qu'**une
   * fois**. Le second appel ne la repropose pas — elle est déjà sur la table,
   * et c'est aux autres de répondre.
   */
  decider(vue: PublicGameView, moi: PrivatePlayerView): Coup | undefined {
    if (vue.winner !== undefined) return undefined;
    if (vue.cycle !== this.cycleVu) {
      this.cycleVu = vue.cycle;
      this.offresDuCycle = 0;
    }

    const caps = new Set<string>(moi.capabilities);
    const lecture = new Lecture(vue);

    // Une défausse due bloque toute la table : elle passe avant tout.
    if (moi.mustDiscard > 0) return this.defausser(vue, moi, lecture);

    // L'objectif secret se choisit une fois, dès qu'il est proposé. Le
    // laisser en suspens revient à jouer deux points de moins toute la
    // partie — c'est ce que faisaient les bots jusqu'ici.
    if (moi.chosenObjective === undefined && moi.offeredObjectives.length > 0) {
      return { type: 'CHOOSE_OBJECTIVE', objective: this.choisirLObjectif(moi.offeredObjectives) };
    }

    if (caps.has('CAN_PLACE_SETUP')) return this.miseEnPlace(moi, lecture);

    if (caps.has('CAN_MOVE_ROBBER')) return this.voleur(vue, moi, lecture, 'MOVE_ROBBER');

    // Le chevalier se joue avant le lancer : c'est le seul moment où il
    // déplace le voleur *avant* que la production ne tombe.
    if (caps.has('CAN_PLAY_KNIGHT') && moi.playableDevCards.includes('knight')
        && this.veutJouerUnChevalier(vue, moi, lecture)) {
      const coup = this.voleur(vue, moi, lecture, 'PLAY_KNIGHT');
      if (coup) return coup;
    }

    if (caps.has('CAN_ROLL_DICE')) return { type: 'ROLL_DICE' };

    const but = this.plan(vue, moi, lecture);

    // Accepter est immédiat et gratuit : une offre qui apporte la carte
    // manquante ne se refuse pas, et elle expire à la fin du cycle.
    const acceptation = this.accepter(vue, moi, lecture, but);
    if (acceptation) return acceptation;

    if (caps.has('CAN_PLAY_DEV_CARD')) {
      const carte = this.jouerUneCarte(moi, lecture, but);
      if (carte) return carte;
    }

    if (caps.has('CAN_BUILD')) {
      const construction = this.construire(moi, lecture, but);
      if (construction) return construction;
    }

    if (caps.has('CAN_BUY_DEV_CARD') && this.veutUneCarte(vue, moi, but)) {
      return { type: 'BUY_DEV_CARD' };
    }

    /*
     * La banque ou la table, et dans quel ordre.
     *
     * Un même geste — se procurer la carte qui manque — a deux chemins, et
     * lequel on prend en premier est ce qui distingue le plus nettement deux
     * caractères à la même table. Celui qui vit du négoce demande d'abord
     * aux autres : c'est moins cher qu'un cours à cinq, et cela fait vivre
     * la partie. Les autres paient le cours sans discuter et gardent leurs
     * cartes pour eux.
     *
     * L'ordre inverse annulait le caractère : le marchand convertissait à la
     * banque avant d'avoir eu l'idée de proposer, et proposait donc moins
     * souvent qu'un bâtisseur.
     */
    const negocieDAbord = this.niveau.negocie && this.traits.commerce >= 0.7;

    if (negocieDAbord && caps.has('CAN_TRADE_PLAYER')) {
      const offre = this.proposer(vue, moi, lecture, but);
      if (offre) return offre;
    }

    // Convertir plutôt que thésauriser — mais vers le coût du plan, pas vers
    // « ce dont j'ai le moins », qui ne mène nulle part.
    if (caps.has('CAN_TRADE_BANK')) {
      const conversion = this.convertir(moi, lecture, but);
      if (conversion) return conversion;
    }

    if (!negocieDAbord && caps.has('CAN_TRADE_PLAYER') && this.niveau.negocie) {
      const offre = this.proposer(vue, moi, lecture, but);
      if (offre) return offre;
    }

    // Annoncer hors de son tour (§8) : c'est la seule façon d'exister quand
    // on ne joue qu'un cycle sur douze, et les bots ne le faisaient jamais.
    if (caps.has('CAN_DECLARE_BUILD') && this.niveau.annonce && this.annonceDuCycle !== vue.cycle) {
      const annonce = this.annoncer(vue, moi, lecture, but);
      if (annonce) { this.annonceDuCycle = vue.cycle; return annonce; }
    }

    if (this.profil.conclut) {
      if (caps.has('CAN_END_TURN')) return { type: 'END_TURN' };
      if (caps.has('CAN_END_CYCLE')) return { type: 'END_CYCLE' };
    }

    return undefined;
  }

  // ── le plan ───────────────────────────────────────────────────────────

  private plan(vue: PublicGameView, moi: PrivatePlayerView, lecture: Lecture): But | undefined {
    if (!this.niveau.plan) return undefined;
    const restant = vue.victoryTarget - moi.points;
    return butDeFin(moi, lecture, restant, this.niveau.horizon)
      ?? choisirLeBut(vue, moi, lecture, this.profil.caractere);
  }

  /** Ce que le plan réclame encore, ou la disette générale à défaut de plan. */
  private manques(moi: PrivatePlayerView, lecture: Lecture, but: But | undefined): ResourceCounts {
    if (but) return but.manque;
    // Sans plan — au premier niveau — on vise ce dont on a le moins, ce qui
    // est exactement l'ancienne heuristique, conservée pour qu'un apprenti
    // reste un apprenti.
    const revenu = lecture.revenuDe(moi.id);
    const besoin = besoinsDe(moi.hand, revenu);
    let pire: Resource | undefined;
    for (const r of CORE_RESOURCES) {
      if (pire === undefined || (besoin[r] ?? 0) > (besoin[pire] ?? 0)) pire = r;
    }
    return pire === undefined ? {} : counts({ [pire]: 1 });
  }

  // ── mise en place ─────────────────────────────────────────────────────

  /**
   * Poser sa première colonie, puis sa route.
   *
   * C'est le coup le plus lourd de la partie, et c'est celui que les bots
   * jouaient le plus mal : ils prenaient le premier emplacement de la liste,
   * triée par identifiant. Une colonie sur un 2 et un 12 ne produit presque
   * jamais, et la partie était perdue avant le premier lancer.
   */
  private miseEnPlace(moi: PrivatePlayerView, lecture: Lecture): Coup | undefined {
    if (moi.spots.roads.length > 0) {
      // La route de mise en place part de la colonie qu'on vient de poser :
      // elle vaut ce que vaut le sommet qu'elle ouvre de l'autre côté.
      const besoin = besoinsDe(moi.hand, lecture.revenuDe(moi.id));
      const libres = lecture.sitesLibres();
      const edge = this.elire(
        moi.spots.roads,
        (e) => valeurDeLArete(lecture, e, besoin, libres),
        'route-mise-en-place');
      return edge === undefined ? undefined : { type: 'PLACE_SETUP_ROAD', edge };
    }

    if (moi.spots.settlements.length === 0) return undefined;

    // La seconde colonie complète la première : `besoinsDe` lit le revenu
    // déjà acquis, donc elle penche d'elle-même vers ce qui manque.
    const besoin = besoinsDe(moi.hand, lecture.revenuDe(moi.id));
    const vertex = this.elire(
      moi.spots.settlements,
      (v) => valeurDuSommet(lecture, v, besoin, { maritime: this.traits.marine }),
      'colonie-mise-en-place');
    return vertex === undefined ? undefined : { type: 'PLACE_SETUP_SETTLEMENT', vertex };
  }

  // ── défausse ──────────────────────────────────────────────────────────

  /**
   * Se séparer de ce qui ne sert pas.
   *
   * L'ancienne défausse rendait le plus abondant, ce qui jetait justement les
   * trois minerais réunis pour une ville. On rend d'abord ce que le plan ne
   * réclame pas, du plus abondant au moins — et on ne descend sur le
   * nécessaire que s'il n'y a plus rien d'autre.
   */
  private defausser(vue: PublicGameView, moi: PrivatePlayerView, lecture: Lecture): Coup {
    const combien = Math.min(moi.mustDiscard, total(moi.hand));
    const but = this.plan(vue, moi, lecture);
    const requis = but?.cout ?? {};

    const reste: Partial<Record<Resource, number>> = {};
    for (const r of RESOURCES) reste[r] = amount(moi.hand, r);

    const rendu: Partial<Record<Resource, number>> = {};
    for (let i = 0; i < combien; i++) {
      let choix: Resource | undefined;
      let pire = -Infinity;
      for (const r of RESOURCES) {
        const enMain = reste[r] ?? 0;
        if (enMain <= 0) continue;
        // Ce qu'on garderait volontiers : ce que le plan réclame, et ce dont
        // il ne reste qu'un exemplaire d'une nature rare.
        const utile = this.niveau.defausseFine
          ? Math.min(enMain, amount(requis, r)) * 3 + (r === 'gold' ? 1.5 : 0)
          : 0;
        const score = enMain - utile;
        if (score > pire) { pire = score; choix = r; }
      }
      if (choix === undefined) break;
      reste[choix] = (reste[choix] ?? 0) - 1;
      rendu[choix] = (rendu[choix] ?? 0) + 1;
    }

    return { type: 'DISCARD', resources: counts(rendu) };
  }

  // ── objectif secret ───────────────────────────────────────────────────

  private choisirLObjectif(offerts: readonly ObjectiveId[]): ObjectiveId {
    const premier = offerts[0] as ObjectiveId;
    if (!this.niveau.objectif) return premier;
    const elu = this.elire(offerts, (id) => (AFFINITES[id]?.(this.profil.caractere) ?? 0.5) * 10, 'objectif');
    return elu ?? premier;
  }

  // ── voleur et chevaliers ──────────────────────────────────────────────

  /**
   * Où poser le voleur, et qui dépouiller.
   *
   * Trois visées selon le niveau : le premier hexagone venu, celui qui coûte
   * le plus à la table, ou celui qui coûte le plus **au meneur**. La
   * troisième est ce qui rend une partie tendue — un joueur qui prend la tête
   * le sent immédiatement.
   */
  private voleur(
    vue: PublicGameView,
    moi: PrivatePlayerView,
    lecture: Lecture,
    type: 'MOVE_ROBBER' | 'PLAY_KNIGHT',
  ): Coup | undefined {
    const cibles = moi.spots.robber;
    if (cibles.length === 0) return undefined;

    const vise = this.designer(vue, moi, lecture);
    const mesHexes = lecture.hexesDe(moi.id);

    const hex = this.niveau.visee === 'premier'
      ? cibles[Math.floor(this.tirage('voleur:hasard') * cibles.length)]
      : this.elire(cibles, (id) => {
          const victimes = moi.spots.robberVictims[id] ?? [];
          let gene = 0;
          for (const victime of victimes) {
            const poids = lecture.hexesDe(victime).get(id) ?? 0;
            const cartes = lecture.joueurs.get(victime)?.handSize ?? 0;
            const priorite = vise !== undefined && victime === vise ? 2.5 : 1;
            gene += (poids + Math.min(cartes, 8) * 0.4) * priorite;
          }
          // Se bloquer soi-même n'a jamais aidé personne.
          return gene - (mesHexes.get(id) ?? 0) * 3;
        }, 'voleur-hex');

    if (hex === undefined) return undefined;

    // La victime la plus fournie : voler une main vide, c'est déplacer le
    // voleur pour rien.
    const victimes = moi.spots.robberVictims[hex] ?? [];
    const victime = this.niveau.visee === 'premier'
      ? victimes[0]
      : this.elire(victimes, (v) => {
          const cartes = lecture.joueurs.get(v)?.handSize ?? 0;
          return cartes + (v === vise ? 4 : 0);
        }, 'voleur-victime');

    return { type, to: hex, ...(victime !== undefined ? { victim: victime } : {}) };
  }

  /**
   * Qui le bot cherche à gêner.
   *
   * Viser le meneur est le geste que toute la table attend d'un bon joueur —
   * et c'est un geste **coûteux** : le voleur posé sur le meneur ne rapporte
   * rien à celui qui le pose, il rend service aux dix autres. Mesuré sur
   * trente-deux parties, un stratège qui vise systématiquement le meneur
   * *perd* contre un aguerri qui vise simplement la main la plus grosse :
   * huit victoires à quinze, contre quatorze à neuf dans l'autre sens.
   *
   * C'est le problème du faiseur de rois, et il ne se règle pas en cessant
   * de viser le meneur — un jeu où personne ne freine celui qui gagne se
   * décide au cinquième cycle. Il se règle en ne le freinant **que lorsque
   * c'est urgent** : quand il touche au but, ou qu'il a pris une avance que
   * rien d'autre ne rattrapera. Le reste du temps, le stratège joue pour lui.
   */
  private designer(vue: PublicGameView, moi: PrivatePlayerView, lecture: Lecture): PlayerId | undefined {
    if (this.niveau.visee === 'premier') return undefined;

    if (this.niveau.visee === 'meneur') {
      const meneur = lecture.meneur(moi.id);
      const moiPublic = lecture.joueurs.get(moi.id);
      const urgent = meneur !== undefined && moiPublic !== undefined
        && (meneur.publicPoints >= vue.victoryTarget - 4
          || meneur.publicPoints >= moiPublic.publicPoints + 3);
      if (urgent && meneur) return meneur.id;
    }

    return lecture.plusRiche(moi.id)?.id;
  }

  /**
   * Jouer un chevalier maintenant, ou le garder.
   *
   * Un chevalier gardé ne vaut rien : c'est ce que montrait la mesure, où la
   * plus grande puissance militaire n'était jamais attribuée. Mais un
   * chevalier joué sur un hexagone vide ne vaut rien non plus. On le sort
   * quand il rapporte le titre, quand il gêne réellement, ou quand le
   * caractère y pousse.
   */
  private veutJouerUnChevalier(
    vue: PublicGameView,
    moi: PrivatePlayerView,
    lecture: Lecture,
  ): boolean {
    if (this.niveau.regard === 0) return true;

    const moiPublic = lecture.joueurs.get(moi.id);
    if (!moiPublic) return false;

    // Le titre vaut deux points : dès qu'il est à portée, le chevalier sort.
    const tenant = vue.largestArmyHolder === undefined
      ? DEFAULT_MINIMUM_KNIGHTS - 1
      : (lecture.joueurs.get(vue.largestArmyHolder)?.knightsPlayed ?? 0);
    if (vue.largestArmyHolder !== moiPublic.id && moiPublic.knightsPlayed + 1 > tenant) return true;

    const cibles = moi.spots.robber;
    if (cibles.length === 0) return false;

    // Sinon, il faut que quelqu'un ait quelque chose à perdre.
    const proie = this.designer(vue, moi, lecture);
    const aQuiVoler = cibles.some((id) => (moi.spots.robberVictims[id] ?? []).some((v) => {
      const cartes = lecture.joueurs.get(v)?.handSize ?? 0;
      return cartes >= 3 && (proie === undefined || v === proie || this.traits.agression > 0.6);
    }));

    return aQuiVoler && this.tirage('chevalier') < 0.4 + this.traits.agression * 0.6;
  }

  // ── cartes développement ──────────────────────────────────────────────

  private jouerUneCarte(
    moi: PrivatePlayerView,
    lecture: Lecture,
    but: But | undefined,
  ): Coup | undefined {
    const enMain = new Set(moi.playableDevCards);
    const manque = this.manques(moi, lecture, but);

    /*
     * L'Invention comble le trou du plan.
     *
     * Deux cartes choisies valent presque toujours mieux que deux cartes
     * subies : c'est la seule carte qui transforme un plan bloqué en
     * construction immédiate.
     */
    if (enMain.has('invention')) {
      const voulues = this.deuxCartes(manque, moi.hand);
      if (voulues) return { type: 'PLAY_INVENTION', resources: voulues };
    }

    /*
     * Le Monopole se joue sur ce que la table détient, pas sur ce qui manque.
     *
     * Les inventaires sont publics (voir l'en-tête de `views.ts`) : le bot
     * peut donc compter avant de choisir, exactement comme un joueur qui
     * regarde la table. Il ne sort la carte que si la moisson en vaut la
     * peine — un monopole à deux cartes est une carte gâchée.
     */
    if (enMain.has('monopoly')) {
      const cible = this.elire(
        [...CORE_RESOURCES],
        (r) => lecture.circulation(r, moi.id) + amount(manque, r) * 2,
        'monopole');
      if (cible !== undefined) {
        const recolte = lecture.circulation(cible, moi.id);
        const seuil = this.niveau.regard === 0 ? 1 : 4;
        if (recolte >= seuil) return { type: 'PLAY_MONOPOLY', resource: cible };
      }
    }

    if (enMain.has('freeBuild')) {
      const cible = this.constructionOfferte(moi, lecture, but);
      if (cible) return { type: 'PLAY_FREE_BUILD', target: cible };
    }

    if (enMain.has('roadBuilding') && moi.spots.roads.length > 0) {
      const besoin = besoinsDe(moi.hand, lecture.revenuDe(moi.id));
      const libres = lecture.sitesLibres();
      const classees = [...moi.spots.roads]
        .sort((a, b) => valeurDeLArete(lecture, b, besoin, libres) - valeurDeLArete(lecture, a, besoin, libres));
      const edges = classees.slice(0, 2);
      if (edges.length > 0) return { type: 'PLAY_ROAD_BUILDING', edges };
    }

    return undefined;
  }

  /** Où placer la construction offerte par la carte Bâtisseur. */
  private constructionOfferte(
    moi: PrivatePlayerView,
    lecture: Lecture,
    but: But | undefined,
  ): IntentTarget | undefined {
    const besoin = besoinsDe(moi.hand, lecture.revenuDe(moi.id));

    // La ville d'abord : c'est la construction la plus chère que la carte
    // puisse offrir, donc celle qui économise le plus.
    const veutColonie = but?.kind === 'settlement' || this.traits.expansion > this.traits.developpement;
    if (!veutColonie && moi.spots.cities.length > 0) {
      const vertex = this.elire(moi.spots.cities, (v) => this.valeurDeLaVille(lecture, v), 'offerte-ville');
      if (vertex !== undefined) return { kind: 'city', vertex };
    }
    if (moi.spots.settlements.length > 0) {
      const vertex = this.elire(
        moi.spots.settlements,
        (v) => valeurDuSommet(lecture, v, besoin, { maritime: this.traits.marine }),
        'offerte-colonie');
      if (vertex !== undefined) return { kind: 'settlement', vertex };
    }
    if (moi.spots.cities.length > 0) {
      const vertex = this.elire(moi.spots.cities, (v) => this.valeurDeLaVille(lecture, v), 'offerte-ville-2');
      if (vertex !== undefined) return { kind: 'city', vertex };
    }
    if (moi.spots.roads.length > 0) {
      const libres = lecture.sitesLibres();
      const edge = this.elire(moi.spots.roads, (e) => valeurDeLArete(lecture, e, besoin, libres), 'offerte-route');
      if (edge !== undefined) return { kind: 'road', edge };
    }
    return undefined;
  }

  /** Deux cartes à réclamer, en comblant d'abord le trou le plus large. */
  private deuxCartes(manque: ResourceCounts, main: ResourceCounts): ResourceCounts | undefined {
    const voulu: Partial<Record<Resource, number>> = {};
    let pris = 0;
    const ordre = [...CORE_RESOURCES].sort((a, b) => amount(manque, b) - amount(manque, a));
    for (const r of ordre) {
      while (pris < 2 && (voulu[r] ?? 0) < amount(manque, r)) {
        voulu[r] = (voulu[r] ?? 0) + 1;
        pris++;
      }
    }
    // Rien ne manque : on prend ce dont on a le moins, plutôt que de garder
    // la carte jusqu'à la fin de la partie.
    if (pris < 2) {
      const ordreMain = [...CORE_RESOURCES].sort((a, b) => amount(main, a) - amount(main, b));
      for (const r of ordreMain) {
        while (pris < 2) { voulu[r] = (voulu[r] ?? 0) + 1; pris++; }
      }
    }
    return pris === 2 ? counts(voulu) : undefined;
  }

  private veutUneCarte(vue: PublicGameView, moi: PrivatePlayerView, but: But | undefined): boolean {
    if (vue.deckRemaining === 0) return false;
    if (but?.kind === 'devCard') return true;
    if (this.niveau.regard === 0) return true;
    /*
     * Trois cartes qui deviennent une carte que le sept ne prend pas.
     *
     * La carte développement ne compte pas dans la limite de main : à une
     * carte de la défausse, l'acheter n'est pas un pari, c'est une mise à
     * l'abri. C'est le geste qu'un joueur fait d'instinct et qu'aucun bot ne
     * faisait — d'où soixante-dix défausses par partie.
     */
    if (this.niveau.tientSaMain && total(moi.hand) >= vue.handLimit - 1) return true;
    // Une carte achetée est une construction repoussée : on ne l'achète que
    // si le plan est hors de portée, ou si le caractère y pousse.
    const bloque = but === undefined || total(but.manque) > 0;
    if (!bloque) return false;
    return this.tirage('pioche') < this.traits.cartes * 0.7;
  }

  // ── construire ────────────────────────────────────────────────────────

  private construire(
    moi: PrivatePlayerView,
    lecture: Lecture,
    but: But | undefined,
  ): Coup | undefined {
    // Le plan d'abord, s'il est payable : c'est lui qui a orienté tous les
    // échanges du cycle.
    if (but && canAfford(moi.hand, but.cout) && but.kind !== 'devCard') {
      const coup = this.poser(but.kind, moi, lecture);
      if (coup) return coup;
    }

    // Sinon, la meilleure construction payable — mais toujours dans l'ordre
    // de ce qu'elle rapporte, jamais dans l'ordre de la liste.
    const payables: But['kind'][] = [];
    const monEtat = lecture.joueurs.get(moi.id);
    if (!monEtat) return undefined;

    if (canAfford(moi.hand, COSTS.monument) && moi.spots.monuments.length > 0) payables.push('monument');
    if (canAfford(moi.hand, COSTS.city) && monEtat.citiesLeft > 0 && moi.spots.cities.length > 0) {
      payables.push('city');
    }
    if (canAfford(moi.hand, COSTS.settlement) && monEtat.settlementsLeft > 0 && moi.spots.settlements.length > 0) {
      payables.push('settlement');
    }
    if (canAfford(moi.hand, COSTS.metropolis) && moi.spots.metropolises.length > 0) payables.push('metropolis');
    if (canAfford(moi.hand, COSTS.road) && monEtat.roadsLeft > 0 && moi.spots.roads.length > 0) payables.push('road');
    if (canAfford(moi.hand, COSTS.maritimeRoute) && monEtat.roadsLeft > 0 && moi.spots.maritime.length > 0) {
      payables.push('maritimeRoute');
    }
    if (payables.length === 0) return undefined;

    /*
     * Garder de quoi finir le plan.
     *
     * Un bâtisseur qui pose une route avec le bois réservé à sa colonie
     * recule d'un cycle. On ne dépense hors plan que ce qui ne casse rien —
     * sauf au premier niveau, où l'on construit dès qu'on peut.
     */
    const gene = (kind: But['kind']): boolean => {
      if (!but || this.niveau.regard === 0) return false;
      if (kind === but.kind) return false;
      const cout = coutDe(kind);
      if (!canAfford(moi.hand, cout)) return true;
      const apres = subtractCounts(moi.hand, cout);
      return total(missingFor(apres, but.cout)) > total(but.manque);
    };

    const ordre = payables.filter((k) => !gene(k));
    const retenu = this.elire(ordre.length > 0 ? ordre : payables, (k) => VALEUR_BRUTE[k] ?? 0, 'construction');
    return retenu === undefined ? undefined : this.poser(retenu, moi, lecture);
  }

  /** Poser une construction d'un type donné, au meilleur endroit disponible. */
  private poser(kind: But['kind'], moi: PrivatePlayerView, lecture: Lecture): Coup | undefined {
    const besoin = besoinsDe(moi.hand, lecture.revenuDe(moi.id));

    switch (kind) {
      case 'monument': {
        const vertex = moi.spots.monuments[0];
        return vertex === undefined ? undefined : { type: 'BUILD_MONUMENT', vertex };
      }
      case 'metropolis': {
        const vertex = this.elire(moi.spots.metropolises, (v) => this.valeurDeLaVille(lecture, v), 'metropole');
        return vertex === undefined ? undefined : { type: 'BUILD_METROPOLIS', vertex };
      }
      case 'city': {
        const vertex = this.elire(moi.spots.cities, (v) => this.valeurDeLaVille(lecture, v), 'ville');
        return vertex === undefined ? undefined : { type: 'BUILD_CITY', vertex };
      }
      case 'settlement': {
        const vertex = this.elire(
          moi.spots.settlements,
          (v) => valeurDuSommet(lecture, v, besoin, { maritime: this.traits.marine }),
          'colonie');
        return vertex === undefined ? undefined : { type: 'BUILD_SETTLEMENT', vertex };
      }
      case 'road': {
        const libres = lecture.sitesLibres();
        const edge = this.elire(moi.spots.roads, (e) => valeurDeLArete(lecture, e, besoin, libres), 'route');
        return edge === undefined ? undefined : { type: 'BUILD_ROAD', edge };
      }
      case 'maritimeRoute': {
        const libres = lecture.sitesLibres();
        const edge = this.elire(moi.spots.maritime, (e) => valeurDeLArete(lecture, e, besoin, libres), 'maritime');
        return edge === undefined ? undefined : { type: 'BUILD_MARITIME_ROUTE', edge };
      }
      default:
        return undefined;
    }
  }

  /**
   * Ce que vaut une colonie à améliorer.
   *
   * Une ville double la production de son sommet : améliorer le sommet le
   * plus fourni est donc toujours le bon choix, et c'est celui que
   * l'ancienne liste triée par identifiant ne faisait jamais.
   */
  private valeurDeLaVille(lecture: Lecture, vertex: VertexId): number {
    const production = lecture.productionDuSommet(vertex);
    let somme = 0;
    for (const r of RESOURCES) somme += amount(production, r);
    return somme;
  }

  // ── échanges avec la banque et les ports ──────────────────────────────

  private convertir(
    moi: PrivatePlayerView,
    lecture: Lecture,
    but: But | undefined,
  ): Coup | undefined {
    const manque = this.manques(moi, lecture, but);
    const voulu = this.elire(
      RESOURCES.filter((r) => amount(manque, r) > 0),
      (r) => amount(manque, r),
      'conversion-voulu')
      // Rien ne manque : on se dote de ce qu'on n'a pas du tout, plutôt que
      // de laisser dormir un surplus que le prochain sept emportera.
      ?? this.elire(CORE_RESOURCES.filter((r) => amount(moi.hand, r) === 0), () => 1, 'conversion-defaut');
    if (voulu === undefined) return undefined;

    const cout = but?.cout ?? {};
    /** Une carte est en trop si le plan n'en a pas besoin. */
    const surplus = (r: Resource): number =>
      Math.max(0, amount(moi.hand, r) - (this.niveau.plan ? amount(cout, r) : 0));

    /*
     * Le port commercial d'abord (§11) : deux cartes de natures différentes
     * contre une au choix, hors marché. Il bat le cours dès que celui-ci
     * dépasse deux, c'est-à-dire presque toujours.
     */
    if (moi.ports.includes('commercial')) {
      const spare = CORE_RESOURCES
        .filter((r) => r !== voulu && surplus(r) > 0)
        .sort((a, b) => surplus(b) - surplus(a));
      const [premier, second] = spare;
      if (premier !== undefined && second !== undefined) {
        return {
          type: 'TRADE_AT_PORT', port: 'commercial',
          give: counts({ [premier]: 1, [second]: 1 }),
          receive: counts({ [voulu]: 1 }),
        };
      }
    }

    /*
     * Le port minier, pour la métropole et pour elle seule.
     *
     * Deux minerai contre un or : c'est le seul chemin praticable vers les
     * deux ors qu'elle coûte, et il restait inutilisé faute d'un bot qui
     * sache pourquoi il voudrait de l'or.
     */
    if (moi.ports.includes('mining') && but?.kind === 'metropolis'
        && amount(but.manque, 'gold') > 0 && surplus('ore') >= 2) {
      return {
        type: 'TRADE_AT_PORT', port: 'mining',
        give: counts({ ore: 2 }), receive: counts({ gold: 1 }),
      };
    }

    // Le cours : on vend ce qui coûte le moins cher à vendre, pas ce qu'on a
    // le plus — un port change complètement ce calcul.
    let vendue: Resource | undefined;
    let taux = Infinity;
    for (const r of RESOURCES) {
      if (r === voulu) continue;
      const prix = moi.bankRates[r] ?? 4;
      if (surplus(r) < prix) continue;
      if (prix < taux || (prix === taux && vendue !== undefined && surplus(r) > surplus(vendue))) {
        vendue = r; taux = prix;
      }
    }
    if (vendue === undefined) return undefined;

    return {
      type: 'TRADE_WITH_BANK',
      give: counts({ [vendue]: taux }),
      receive: counts({ [voulu]: 1 }),
    };
  }

  // ── négociation entre joueurs ─────────────────────────────────────────

  /**
   * Accepter une offre, ou la laisser passer.
   *
   * Le §37 fait de la négociation le cœur du jeu à douze : c'est par elle
   * qu'un joueur qui n'agit qu'un cycle sur douze reste dans la partie. Un
   * bot qui accepte tout est un distributeur ; un bot qui n'accepte rien
   * assèche la table. La règle retenue : ce qu'on reçoit doit servir le plan,
   * et ce qu'on donne ne doit pas le casser.
   */
  private accepter(
    vue: PublicGameView,
    moi: PrivatePlayerView,
    lecture: Lecture,
    but: But | undefined,
  ): Coup | undefined {
    if (moi.acceptableOffers.length === 0) return undefined;
    const manque = this.manques(moi, lecture, but);
    const besoin = besoinsDe(moi.hand, lecture.revenuDe(moi.id));
    const meneur = lecture.meneur(moi.id);

    const recevables = vue.offers.filter((o) => moi.acceptableOffers.includes(o.id));
    const jugees = recevables
      .map((offre) => ({ offre, valeur: this.valeurDeLOffre(offre, moi, manque, besoin) }))
      .filter(({ offre, valeur }) => valeur > 0
        && this.recevable(offre, moi, but, meneur, vue));
    if (jugees.length === 0) return undefined;

    const elu = this.elire(jugees, (j) => j.valeur, 'acceptation');
    return elu === undefined ? undefined : { type: 'ACCEPT_TRADE', offerId: elu.offre.id };
  }

  /**
   * Ce qu'une offre rapporte, une fois retranché ce qu'elle coûte.
   *
   * Un seuil binaire — « apporte-t-elle exactement la carte du plan ? » —
   * faisait tomber le taux d'acceptation à cinq pour cent : la table
   * proposait sans arrêt et n'échangeait jamais. Une carte a une valeur
   * continue : ce qui manque au plan vaut le plus, ce qui manque au sol vaut
   * ensuite, et ce dont on a déjà cinq exemplaires ne vaut presque rien.
   *
   * Le résultat est un vrai marchandage : deux cartes contre une passent
   * presque toujours, une contre une seulement si le troc est utile.
   */
  private valeurDeLOffre(
    offre: PublicOffer,
    moi: PrivatePlayerView,
    manque: ResourceCounts,
    besoin: Readonly<Partial<Record<Resource, number>>>,
  ): number {
    const prix = (r: Resource): number =>
      0.6 + (besoin[r] ?? 0) + (amount(manque, r) > 0 ? 1.2 : 0);

    let gain = 0;
    for (const r of RESOURCES) {
      // Au-delà du nécessaire, une carte de plus vaut moins : c'est ce qui
      // empêche d'accumuler six bois en croyant faire une affaire.
      const utiles = Math.max(amount(manque, r), 1);
      const recu = amount(offre.give, r);
      gain += Math.min(recu, utiles) * prix(r) + Math.max(0, recu - utiles) * 0.3;
    }

    let perte = 0;
    for (const r of RESOURCES) {
      const cede = amount(offre.receive, r);
      if (cede === 0) continue;
      const restant = amount(moi.hand, r) - cede;
      // Céder sa dernière carte d'une nature coûte plus cher que céder la
      // quatrième : le manque se paie ensuite au cours.
      perte += cede * prix(r) * (restant <= 0 ? 1.8 : restant === 1 ? 1.2 : 1);
    }

    // Un stratège demande une marge, un apprenti prend ce qui passe.
    const exigence = this.niveau.regard === 0 ? -0.5 : this.traits.prudence * 0.3;
    return gain - perte * (1 + exigence);
  }

  /** Les refus de principe, ceux qu'aucune valeur ne rachète. */
  private recevable(
    offre: PublicOffer,
    moi: PrivatePlayerView,
    but: But | undefined,
    meneur: { id: PlayerId; publicPoints: number } | undefined,
    vue: PublicGameView,
  ): boolean {
    if (!canAfford(moi.hand, offre.receive)) return false;
    if (this.niveau.regard === 0) return true;

    // Ne pas céder ce que le plan attend encore : c'est le seul cas où une
    // bonne affaire fait perdre un cycle entier.
    if (but && this.niveau.plan) {
      const avant = total(missingFor(moi.hand, but.cout));
      const apres = addCounts(subtractCounts(moi.hand, offre.receive), offre.give);
      if (total(missingFor(apres, but.cout)) > avant) return false;
    }

    /*
     * Ne pas armer le meneur.
     *
     * Seulement quand il est vraiment près du but : refuser plus tôt
     * paralyserait le marché, et la mesure l'a montré — un bot trop exigeant
     * fait tomber le taux d'acceptation et la table cesse d'échanger.
     */
    if (this.niveau.visee === 'meneur' && meneur && offre.from === meneur.id) {
      if (meneur.publicPoints >= vue.victoryTarget - 3) return false;
    }

    return true;
  }

  /**
   * Proposer un échange.
   *
   * Les bots ne proposaient rien sur le réseau : ils attendaient qu'un humain
   * pense à eux, ce qui, à onze adversaires, n'arrive jamais. C'est pourtant
   * le geste qui rend une table vivante — et comme les inventaires sont
   * publics, l'offre peut être adressée à quelqu'un qui a réellement la carte
   * et à qui la contrepartie sert.
   */
  private proposer(
    vue: PublicGameView,
    moi: PrivatePlayerView,
    lecture: Lecture,
    but: But | undefined,
  ): Coup | undefined {
    // Une seule offre en vol, et quelques-unes par cycle au plus : un
    // marchand qui inonde la table finit par n'être plus lu.
    if (vue.offers.some((o) => o.from === moi.id)) return undefined;
    const plafond = 1 + Math.round(this.traits.commerce * 3);
    if (this.offresDuCycle >= plafond) return undefined;

    const manque = this.manques(moi, lecture, but);

    /*
     * Combien il faut manquer avant de demander.
     *
     * C'est ici que le négoce devient un tempérament plutôt qu'un réglage.
     * Le marchand demande dès qu'une seule carte lui échappe ; le bâtisseur
     * ne dérange la table que lorsqu'il est franchement bloqué et paie le
     * cours le reste du temps. Sans ce seuil, tous les caractères
     * proposaient à peu près autant, et l'on ne distinguait plus personne.
     */
    const seuil = this.traits.commerce >= 0.7 ? 1 : this.traits.commerce >= 0.5 ? 2 : 3;
    if (total(manque) < seuil) return undefined;

    const voulu = this.elire(
      CORE_RESOURCES.filter((r) => amount(manque, r) > 0),
      (r) => amount(manque, r),
      'offre-voulu');
    if (voulu === undefined) return undefined;

    const cout = but?.cout ?? {};
    const surplus = (r: Resource): number => Math.max(0, amount(moi.hand, r) - amount(cout, r));
    const cede = this.elire(
      CORE_RESOURCES.filter((r) => r !== voulu && surplus(r) > 0),
      (r) => surplus(r) + (this.niveau.negocieCible ? lecture.circulation(r, moi.id) * -0.1 : 0),
      'offre-cede');
    if (cede === undefined) return undefined;

    /*
     * Le prix demandé suit le caractère.
     *
     * Un marchand propose deux contre une et emporte l'affaire ; un bâtisseur
     * propose une contre une et se fait souvent éconduire. C'est visible
     * depuis la table, et c'est le genre de détail qui fait qu'on reconnaît
     * un adversaire au bout de trois cycles.
     */
    const genereux = this.traits.commerce > 0.7 || amount(manque, voulu) >= 2;
    const combien = Math.min(surplus(cede), genereux ? 2 : 1);
    if (combien === 0) return undefined;

    const give = counts({ [cede]: combien });
    const receive = counts({ [voulu]: 1 });

    // À qui l'adresser : quelqu'un qui a la carte, et à qui la nôtre manque.
    /*
     * À qui l'adresser, et quand ne pas l'adresser du tout.
     *
     * Une offre nominative ne peut être acceptée que par son destinataire :
     * mal visée, elle ne sert à rien. On ne vise donc que lorsque quelqu'un
     * a manifestement la carte et n'a manifestement pas la nôtre — les
     * inventaires sont publics, cela se lit. Sinon on laisse l'offre
     * ouverte, où onze joueurs peuvent la prendre.
     */
    let destinataire: PlayerId | undefined;
    if (this.niveau.negocieCible) {
      const candidats = vue.players.filter((p) => p.id !== moi.id && p.connected
        && amount(p.hand, voulu) >= 2 && amount(p.hand, cede) <= 1);
      destinataire = this.elire(
        candidats,
        (p) => amount(p.hand, voulu) * 1.5 - amount(p.hand, cede) - p.publicPoints * 0.3,
        'offre-destinataire')?.id;
    }

    const signature = `${vue.cycle}:${cede}${combien}>${voulu}:${destinataire ?? '*'}`;
    if (signature === this.derniereOffre) return undefined;
    this.derniereOffre = signature;
    this.offresDuCycle++;

    return { type: 'CREATE_TRADE', give, receive, ...(destinataire ? { to: destinataire } : {}) };
  }

  // ── annonce hors tour ─────────────────────────────────────────────────

  /**
   * Annoncer une construction pendant le tour d'un autre (§8).
   *
   * C'est la mécanique qui empêche une partie à douze de devenir onze
   * attentes et un tour. Les bots ne s'en servaient pas du tout : ils
   * regardaient passer onze cycles avant d'agir, et les emplacements qu'ils
   * convoitaient partaient sous leur nez.
   */
  private annoncer(
    vue: PublicGameView,
    moi: PrivatePlayerView,
    lecture: Lecture,
    but: But | undefined,
  ): Coup | undefined {
    if (vue.intents.some((i) => i.player === moi.id)) return undefined;

    /*
     * Tout le monde n'annonce pas, et c'est voulu.
     *
     * Une annonce prend l'emplacement un cycle plus tôt, mais elle immobilise
     * les cartes jusqu'à la résolution et brûle les pièces de réserve plus
     * vite. Mesurée sur des tables entières, elle raccourcit l'expansion de
     * chacun et **allonge** la partie : soixante-dix cycles de plus à six
     * joueurs, parce que le plateau se sature avant que quiconque n'atteigne
     * quinze points.
     *
     * C'est donc un geste de tempérament plutôt qu'une bonne pratique
     * universelle : les caractères qui prennent le terrain le font, les
     * patients laissent passer. On y gagne deux fois — la table reste
     * jouable, et un humain voit que certains adversaires lui coupent
     * l'herbe sous le pied quand d'autres non.
     */
    if (this.traits.expansion + this.traits.agression < 1) return undefined;

    const besoin = besoinsDe(moi.hand, lecture.revenuDe(moi.id));
    const pris = new Set(vue.intents.map((i) => i.location));
    const gele = new Set(vue.frozenLocations);

    // Une annonce réserve les ressources : on n'annonce que ce que le plan
    // veut vraiment, sinon on se prive de son propre tour.
    const veut = but?.kind;

    if (veut === 'settlement' && canAfford(moi.hand, COSTS.settlement)) {
      const libres = moi.spots.settlements.filter((v) => !pris.has(`v:${v}`) && !gele.has(`v:${v}`));
      const vertex = this.elire(
        libres,
        (v) => valeurDuSommet(lecture, v, besoin, { maritime: this.traits.marine }),
        'annonce-colonie');
      if (vertex !== undefined) return { type: 'DECLARE_BUILD', target: { kind: 'settlement', vertex } };
    }

    if (veut === 'city' && canAfford(moi.hand, COSTS.city)) {
      const libres = moi.spots.cities.filter((v) => !pris.has(`v:${v}`) && !gele.has(`v:${v}`));
      const vertex = this.elire(libres, (v) => this.valeurDeLaVille(lecture, v), 'annonce-ville');
      if (vertex !== undefined) return { type: 'DECLARE_BUILD', target: { kind: 'city', vertex } };
    }

    if (veut === 'road' && canAfford(moi.hand, COSTS.road)) {
      const sites = lecture.sitesLibres();
      const libres = moi.spots.roads.filter((e) => !pris.has(`e:${e}`) && !gele.has(`e:${e}`));
      const edge = this.elire(libres, (e) => valeurDeLArete(lecture, e, besoin, sites), 'annonce-route');
      if (edge !== undefined) return { type: 'DECLARE_BUILD', target: { kind: 'road', edge } };
    }

    return undefined;
  }

  // ── choisir, avec la maladresse de son niveau ─────────────────────────

  /**
   * Le meilleur d'une liste — ou pas.
   *
   * Trois régimes selon le niveau : au premier, le hasard pur, parce qu'un
   * apprenti ne regarde pas ; ensuite, le meilleur, avec un bruit qui décroît
   * à mesure que le regard s'aiguise ; et de temps en temps un coup
   * délibérément moins bon, qui est ce qui rend l'adversaire battable sans le
   * rendre absurde.
   */
  private elire<T>(items: readonly T[], score: (item: T) => number, quoi = 'choix'): T | undefined {
    if (items.length === 0) return undefined;
    if (items.length === 1) return items[0];

    const n = this.niveau;
    const auHasard = (): T | undefined => items[Math.floor(this.tirage(`${quoi}:hasard`) * items.length)];

    if (n.regard <= 0) return auHasard();
    if (n.distraction > 0 && this.tirage(`${quoi}:distrait`) < n.distraction) return auHasard();

    let meilleur = items[0];
    let meilleurScore = -Infinity;
    for (let i = 0; i < items.length; i++) {
      const item = items[i] as T;
      const bruit = (1 - n.regard) * this.tirage(quoi, i) * 5;
      const s = score(item) + bruit;
      if (s > meilleurScore) { meilleurScore = s; meilleur = item; }
    }
    return meilleur;
  }
}

/** Ce que rapporte chaque construction, à départager coût égal. */
const VALEUR_BRUTE: Readonly<Record<But['kind'], number>> = Object.freeze({
  monument: 6, city: 5, settlement: 4, metropolis: 3.5,
  road: 2, maritimeRoute: 2, devCard: 1,
});

function coutDe(kind: But['kind']): ResourceCounts {
  switch (kind) {
    case 'monument': return COSTS.monument;
    case 'metropolis': return COSTS.metropolis;
    case 'city': return COSTS.city;
    case 'settlement': return COSTS.settlement;
    case 'road': return COSTS.road;
    case 'maritimeRoute': return COSTS.maritimeRoute;
    case 'devCard': return COSTS.devCard;
  }
}
