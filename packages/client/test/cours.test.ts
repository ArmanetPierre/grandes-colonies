import { describe, expect, it } from 'vitest';

import { expliquerCours } from '../src/ui/Cours.jsx';

/** Le palier du §10 : quatre transactions nettes pour un cran. */
const STEP = 4;

describe('infobulle du cours', () => {
  it('donne le cours nu quand rien ne bouge', () => {
    expect(expliquerCours('Bois', 5, 5, 0, STEP)).toBe('Bois — cours 5:1');
  });

  it('dit la remise du port', () => {
    expect(expliquerCours('Bois', 5, 3, 0, STEP)).toContain('tu paies 3:1 grâce à ton port');
  });

  it('compte les ventes qui restent avant la hausse', () => {
    // Une vente faite sur quatre : il en reste trois.
    expect(expliquerCours('Bois', 5, 5, 1, STEP)).toContain('3 ventes de plus et il monte à 6:1');
    expect(expliquerCours('Bois', 5, 5, 3, STEP)).toContain('1 vente de plus et il monte à 6:1');
  });

  it('compte les achats qui restent avant la baisse', () => {
    expect(expliquerCours('Minerai', 3, 3, -1, STEP)).toContain('3 achats de plus et il descend à 2:1');
    expect(expliquerCours('Minerai', 3, 3, -3, STEP)).toContain('1 achat de plus et il descend à 2:1');
  });

  it('ne promet rien quand le cours est bloqué contre sa borne', () => {
    // La dérive rendue par le moteur est nulle dans ce cas : rien à annoncer.
    expect(expliquerCours('Bois', 6, 6, 0, STEP)).toBe('Bois — cours 6:1');
  });
});
