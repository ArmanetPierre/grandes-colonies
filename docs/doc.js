/*
 * Documentation Grand Colonies — le peu de script dont elle a besoin.
 *
 * Trois choses, et rien d'autre : le registre clair ou sombre, le sommaire
 * dépliable sur téléphone, et le repère de lecture dans le sommaire. On lit
 * un manuel, on ne regarde pas une démonstration.
 */

(() => {
  const cle = 'grand-colonies-registre';

  /* ── registre clair / sombre ─────────────────────────────────────── */
  const applique = (valeur) => {
    if (valeur) document.documentElement.setAttribute('data-theme', valeur);
    else document.documentElement.removeAttribute('data-theme');
  };

  let choisi = null;
  try { choisi = localStorage.getItem(cle); } catch { /* navigation privée */ }
  // Sans choix mémorisé, on ne touche à rien : le registre du système
  // s'applique de lui-même, et un `data-theme` posé dans la page est respecté.
  if (choisi) applique(choisi);

  const bascule = document.querySelector('.bascule-registre');
  if (bascule) {
    const sombreParDefaut = () => matchMedia('(prefers-color-scheme: dark)').matches;
    const etat = () => document.documentElement.getAttribute('data-theme')
      ?? (sombreParDefaut() ? 'dark' : 'light');
    const nomme = () => { bascule.textContent = etat() === 'dark' ? 'Figures rouges' : 'Figures noires'; };
    nomme();
    bascule.addEventListener('click', () => {
      const suivant = etat() === 'dark' ? 'light' : 'dark';
      applique(suivant);
      try { localStorage.setItem(cle, suivant); } catch { /* tant pis */ }
      nomme();
    });
  }

  /* ── sommaire dépliable, sur écran étroit ────────────────────────── */
  const ouvreur = document.querySelector('.ouvre-sommaire');
  const sommaire = document.querySelector('.sommaire');
  if (ouvreur && sommaire) {
    ouvreur.addEventListener('click', () => {
      const ouvert = sommaire.classList.toggle('ouvert');
      ouvreur.setAttribute('aria-expanded', String(ouvert));
    });
  }

  /* ── repère de lecture ───────────────────────────────────────────── */
  const liens = new Map();
  for (const a of document.querySelectorAll('.sommaire .ancres a')) {
    const href = a.getAttribute('href') || '';
    if (href.startsWith('#')) liens.set(href.slice(1), a);
  }
  if (liens.size) {
    const observateur = new IntersectionObserver((entrees) => {
      for (const entree of entrees) {
        const lien = liens.get(entree.target.id);
        if (!lien || !entree.isIntersecting) continue;
        for (const autre of liens.values()) autre.removeAttribute('aria-current');
        lien.setAttribute('aria-current', 'true');
      }
    }, { rootMargin: '-15% 0px -70% 0px' });
    for (const section of document.querySelectorAll('section[id]')) observateur.observe(section);
  }
})();
