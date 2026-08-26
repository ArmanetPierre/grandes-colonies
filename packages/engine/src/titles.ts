/**
 * Attribution des titres disputés : plus long réseau, plus grande puissance
 * militaire, et tout bonus qui changera de mains en cours de partie.
 *
 * La règle d'égalité est factorisée ici parce qu'elle est identique pour tous
 * et qu'elle est subtile : **à égalité, le titre ne change pas de mains**. Il
 * faut faire strictement mieux que le détenteur pour le lui prendre. La
 * dupliquer dans chaque titre inviterait les deux copies à diverger, et un
 * titre qui s'échangerait à chaque tour rendrait les points de victoire
 * instables — donc le classement illisible en pleine partie.
 */

export interface TitleHolder<T> {
  readonly player: T;
  readonly value: number;
}

export function titleHolder<T>(
  values: ReadonlyMap<T, number>,
  currentHolder: T | undefined,
  minimum: number,
): TitleHolder<T> | undefined {
  const held = currentHolder !== undefined ? (values.get(currentHolder) ?? 0) : 0;

  // Le détenteur conserve le titre tant qu'il reste au seuil.
  const keepsTitle = currentHolder !== undefined && held >= minimum;
  let bestPlayer: T | undefined = keepsTitle ? currentHolder : undefined;
  let bestValue: number = keepsTitle ? held : minimum - 1;

  for (const [player, value] of values) {
    if (value < minimum) continue;
    // Strictement supérieur : l'égalité ne suffit pas à prendre le titre.
    if (value > bestValue) {
      bestPlayer = player;
      bestValue = value;
    }
  }

  return bestPlayer === undefined ? undefined : { player: bestPlayer, value: bestValue };
}
