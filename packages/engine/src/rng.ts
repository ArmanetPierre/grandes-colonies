/**
 * Générateur pseudo-aléatoire déterministe.
 *
 * `Math.random()` est proscrit dans les règles. Tout ce qui relève du hasard —
 * dés, pioche, plateau — passe par ici, pour une raison qui conditionne tout
 * le projet : à graine égale et séquence de commandes égale, une partie doit
 * se rejouer à l'identique. C'est ce qui rend un bug reproductible, un replay
 * possible, et une simulation comparable d'une version du moteur à l'autre.
 *
 * L'état tient en un entier 32 bits, donc se sérialise dans une sauvegarde et
 * se restaure exactement — un instantané pris en cours de partie reprend la
 * même suite de tirages.
 *
 * L'algorithme est mulberry32 : compact, rapide, et de qualité largement
 * suffisante pour des dés et des mélanges. Ce n'est pas un générateur
 * cryptographique et il ne doit jamais servir à en tenir lieu.
 */

export class SeededRandom {
  private state: number;

  constructor(seed: number | string) {
    this.state = typeof seed === 'number' ? seed >>> 0 : hashString(seed);
  }

  /** Reprend exactement là où un instantané s'était arrêté. */
  static fromState(state: number): SeededRandom {
    const rng = new SeededRandom(0);
    rng.state = state >>> 0;
    return rng;
  }

  /** L'état courant, à sérialiser avec la partie. */
  snapshot(): number {
    return this.state;
  }

  /** Flottant dans [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Entier dans [0, maxExclusive). */
  int(maxExclusive: number): number {
    if (maxExclusive <= 0) throw new Error('La borne doit être strictement positive');
    return Math.floor(this.next() * maxExclusive);
  }

  /** Entier dans [min, max], bornes comprises. */
  between(min: number, max: number): number {
    if (max < min) throw new Error('Bornes inversées');
    return min + this.int(max - min + 1);
  }

  /** Un dé à six faces. */
  die(): number {
    return this.int(6) + 1;
  }

  /**
   * Deux dés, avec leur détail.
   *
   * Le total est bien la somme de deux dés et non un tirage uniforme entre 2
   * et 12 : c'est cette distribution en cloche qui donne leur valeur aux
   * jetons 6 et 8, et toute la tension du placement initial.
   */
  roll(): { readonly a: number; readonly b: number; readonly total: number } {
    const a = this.die();
    const b = this.die();
    return { a, b, total: a + b };
  }

  /** Un élément au hasard. Renvoie `undefined` sur une liste vide. */
  pick<T>(items: readonly T[]): T | undefined {
    if (items.length === 0) return undefined;
    return items[this.int(items.length)];
  }

  /** Mélange de Fisher-Yates, sur une copie : l'entrée n'est pas modifiée. */
  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const a = out[i] as T;
      const b = out[j] as T;
      out[i] = b;
      out[j] = a;
    }
    return out;
  }
}

/**
 * Hachage FNV-1a : permet des graines lisibles — « agora-vendredi » plutôt
 * qu'un entier opaque — tout en restant parfaitement déterministe.
 */
function hashString(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
