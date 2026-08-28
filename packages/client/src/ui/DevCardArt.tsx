/**
 * La carte développement, dessinée.
 *
 * Les illustrations existaient déjà — elles avaient été générées puis
 * oubliées dans `public/assets/cards`, jamais affichées. Le panneau se
 * contentait d'un bouton de texte. Ce qui manquait n'était donc pas le
 * dessin mais la **carte** : un cadre, un titre, un effet, un dos.
 *
 * Le cadre est en SVG et en CSS plutôt qu'en image : il doit se redimensionner
 * du pouce d'un téléphone à l'écran de l'hôte sans jamais flouter le texte, et
 * porter la couleur du thème plutôt qu'une bordure figée dans un fichier.
 */

const ART: Record<string, string> = {
  knight: 'card_dev_knight',
  roadBuilding: 'card_dev_road',
  invention: 'card_dev_invention',
  monopoly: 'card_dev_monopoly',
  freeBuild: 'card_dev_freebuild',
};

export const CARD_TITLES: Record<string, string> = {
  knight: 'Chevalier',
  roadBuilding: 'Construction de routes',
  invention: 'Invention',
  monopoly: 'Monopole',
  freeBuild: 'Bâtisseur',
};

/** L'effet, dit en une ligne : c'est ce qu'on relit avant de jouer. */
export const CARD_EFFECTS: Record<string, string> = {
  knight: 'Déplace le voleur et dépouille un voisin. Compte pour la puissance militaire.',
  roadBuilding: 'Pose une ou deux routes sans rien payer.',
  invention: 'Prends deux ressources de ton choix à la banque.',
  monopoly: 'Nomme une ressource : tous les autres joueurs te la cèdent.',
  freeBuild: 'Une construction offerte, au choix.',
};

export interface DevCardArtProps {
  readonly card: string;
  /** Face cachée : la carte achetée ce tour, qu'on ne peut pas encore jouer. */
  readonly facedown?: boolean;
  readonly armed?: boolean;
}

/**
 * Un ornement d'angle, repris des grecques du thème.
 *
 * Quatre exemplaires pivotés suffisent à encadrer la carte sans qu'aucune
 * image ne soit chargée.
 */
function Corner({ at }: { at: string }) {
  return (
    <svg className={`gc-card-corner is-${at}`} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M1 15V5.5A4.5 4.5 0 0 1 5.5 1H15" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M4.6 15V7.2A2.6 2.6 0 0 1 7.2 4.6H15" fill="none" stroke="currentColor" strokeWidth="1" opacity=".5" />
    </svg>
  );
}

export function DevCardArt({ card, facedown = false, armed = false }: DevCardArtProps) {
  const title = CARD_TITLES[card] ?? card;

  if (facedown) {
    return (
      <div className="gc-card is-facedown" title="Achetée ce tour : jouable au prochain">
        <div className="gc-card-frame">
          <img src="/assets/cards/card_back_dev.jpg" alt="" className="gc-card-back" />
          <span className="gc-card-wait">achetée ce tour</span>
        </div>
      </div>
    );
  }

  const art = ART[card];

  return (
    <div className={`gc-card${armed ? ' is-armed' : ''}`}>
      <div className="gc-card-frame">
        {/* L'illustration est cadrée sur le haut : les personnages générés y
            ont la tête, et le bas n'est qu'un sol uni. */}
        {art !== undefined && (
          <div className="gc-card-art" style={{ backgroundImage: `url(/assets/cards/${art}.jpg)` }} />
        )}
        <Corner at="tl" /><Corner at="tr" /><Corner at="bl" /><Corner at="br" />

        <div className="gc-card-plate">
          <span className="gc-card-title">{title}</span>
          <span className="gc-card-effect">{CARD_EFFECTS[card] ?? ''}</span>
        </div>
      </div>
    </div>
  );
}
