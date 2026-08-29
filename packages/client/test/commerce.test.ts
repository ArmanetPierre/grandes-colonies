/**
 * Le panneau de commerce et la bande des cours doivent parler de la même
 * chose.
 *
 * La bande affichait un prix de l'or, les menus ne le proposaient pas : le
 * joueur lisait un tarif que l'interface refusait ensuite d'honorer. Le trou
 * était le pire là où l'or compte — seul débouché du port minier (§11), et
 * un tiers du coût d'une métropole.
 */
import { describe, expect, it } from 'vitest';

import { TRADED } from '../src/ui/Cours.jsx';
import { TRADEABLE } from '../src/ui/Trade.jsx';

describe('ressources négociables', () => {
  it('propose dans les menus exactement ce que la bande chiffre', () => {
    expect([...TRADEABLE].sort()).toEqual([...TRADED].sort());
  });

  it('inclut l or, que le port minier produit et que la métropole coûte', () => {
    expect(TRADEABLE).toContain('gold');
  });

  it('laisse de côté le poisson, qui n a de terrain sur aucun plateau', () => {
    expect(TRADEABLE).not.toContain('fish');
  });
});
