import { describe, expect, it } from 'vitest';

import { lanAddress, readableCode } from '../src/main.js';

describe('adresse LAN', () => {
  /**
   * Elle doit mener quelque part depuis le téléphone d'un invité : la
   * boucle locale fonctionne sur le PC hôte et nulle part ailleurs.
   */
  it('ne renvoie jamais la boucle locale', () => {
    const address = lanAddress();
    if (address === undefined) return; // machine sans réseau : rien à vérifier
    expect(address).not.toBe('127.0.0.1');
    expect(address.startsWith('127.')).toBe(false);
  });

  it('renvoie une adresse IPv4 bien formée', () => {
    const address = lanAddress();
    if (address === undefined) return;
    expect(address).toMatch(/^\d{1,3}(\.\d{1,3}){3}$/);
  });
});

describe('code de partie', () => {
  it('reste stable pour une même graine', () => {
    expect(readableCode('partie-42')).toBe(readableCode('partie-42'));
  });

  it('se lit à voix haute', () => {
    // Un mot, un tiret, deux chiffres : dictable sans épeler.
    expect(readableCode('partie-42')).toMatch(/^[A-Z]+-\d{2}$/);
  });

  it('varie d une partie à l autre', () => {
    const codes = new Set(Array.from({ length: 40 }, (_, i) => readableCode(`partie-${i}`)));
    expect(codes.size).toBeGreaterThan(5);
  });
});
