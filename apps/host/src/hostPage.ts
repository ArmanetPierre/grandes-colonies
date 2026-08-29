/**
 * Écran de l'hôte.
 *
 * C'est la première chose qu'on regarde le soir de la partie, et souvent
 * debout, en montrant l'écran à la ronde. Sa hiérarchie est donc inversée par
 * rapport à une page classique : le QR code et l'adresse écrasent tout le
 * reste, parce que le premier obstacle d'une soirée n'est pas le jeu mais
 * « comment je me connecte ».
 *
 * Vient ensuite le pupitre de réglages. Le nombre de joueurs, la forme du
 * plateau et les durées étaient jusqu'ici des variables d'environnement lues
 * au démarrage : changer d'avis obligeait à tout relancer, donc à faire
 * rejoindre la tablée une seconde fois. Or ce sont exactement les décisions
 * qu'on prend en regardant la pièce se remplir — « on sera dix, finalement »,
 * « la dernière a duré trop longtemps ». Elles se règlent donc ici, et la
 * partie se reconstruit sans que personne ne perde sa place.
 *
 * La page ne connaît aucun réglage à l'avance : elle les lit du serveur et
 * les lui renvoie tels quels. C'est lui qui borne, et deux tables de bornes
 * finiraient par diverger.
 */

import { tableViewMarkup, tableViewScript, tableViewStyles } from './tableView.js';

export interface Bounds { readonly min: number; readonly max: number }

export interface HostPageData {
  readonly url: string;
  readonly code: string;
  readonly qrDataUrl: string;
  /** Bornes des réglages, telles que le serveur les applique. */
  readonly limits: Readonly<Record<string, Bounds>>;
}

export interface SeatSummary {
  readonly name: string;
  readonly connected: boolean;
}

export function renderHostPage(data: HostPageData): string {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Grand Colonies — hôte</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Marcellus&family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  :root {
    --bg:#DFCFAC; --surface:#E9DCBE; --raised:#F2E9D4; --line:#C3AC80;
    --ink:#1B1310; --soft:#5E4A38; --accent:#A63A17; --gold:#A87C22;
  }
  * { box-sizing:border-box; margin:0; padding:0; }
  body {
    background:var(--bg); color:var(--ink); font-family:'Inter',system-ui,sans-serif;
    min-height:100vh; display:grid; place-items:center; padding:28px;
  }
  body:has(#table:not([hidden])) { align-items:start; }
  /* La table de navigation, en fond. L'illustration est chargée en son
     centre — une carte marine, des cordages, un astrolabe — et le QR code
     s'y perdrait : le contenu se pose donc sur un panneau opaque plutôt que
     directement sur l'image. */
  body::before {
    content:''; position:fixed; inset:0; z-index:0;
    background:
      linear-gradient(rgba(223,207,172,.34), rgba(223,207,172,.34)),
      url('/fond.jpg') center / cover no-repeat;
  }
  .card {
    position:relative; z-index:1; width:min(760px,100%); text-align:center;
    background:rgba(233,220,190,.94); border:1px solid var(--line);
    padding:30px 26px; box-shadow:0 4px 24px rgba(30,20,10,.28);
  }
  h1 { font-family:'Marcellus',Georgia,serif; font-size:40px; letter-spacing:.05em; margin-bottom:6px; }
  .sub { color:var(--soft); font-size:14px; margin-bottom:26px; }

  /* L'adresse et le QR code écrasent tout : c'est le seul obstacle réel. */
  .join { display:flex; gap:28px; align-items:center; justify-content:center; flex-wrap:wrap; }
  .qr { background:#fff; padding:12px; border:1px solid var(--line); }
  .qr img { display:block; width:210px; height:210px; }
  .addr { text-align:left; }
  .addr-label { font-size:11px; letter-spacing:.12em; text-transform:uppercase; color:var(--soft); }
  .addr-value { font-family:'Marcellus',Georgia,serif; font-size:34px; line-height:1.15; }
  .code { margin-top:16px; }
  .code-value {
    font-family:'Marcellus',Georgia,serif; font-size:26px; color:var(--accent); letter-spacing:.06em;
  }

  /* ── pupitre de réglages ─────────────────────────────────────────────
     Une section par bloc, séparée d'un filet : c'est la même respiration
     que la liste des sièges, et la carte garde une seule colonne. */
  .block { margin-top:26px; border-top:1px solid var(--line); padding-top:18px; }
  .block-head {
    display:flex; align-items:baseline; gap:12px; margin-bottom:14px;
    font-size:11px; letter-spacing:.12em; text-transform:uppercase; color:var(--soft);
  }
  .block-head .title { flex:1; text-align:left; }

  .rows { display:grid; grid-template-columns:1fr 1fr; gap:10px 22px; text-align:left; }
  @media (max-width:620px) { .rows { grid-template-columns:1fr; } }
  .row { display:flex; align-items:center; gap:10px; min-height:34px; }
  .row > .label { flex:1; font-size:13px; }
  .row > .label small { display:block; font-size:10.5px; color:var(--soft); }
  /* Une ligne qui prend les deux colonnes : les durées, alignées ensemble. */
  .row.wide { grid-column:1 / -1; }

  /* Le pas-à-pas : deux cibles franches et un nombre qu'on lit de loin. */
  .step { display:flex; align-items:center; border:1px solid var(--line); background:var(--raised); }
  .step button {
    width:32px; height:32px; font-size:17px; line-height:1; cursor:pointer;
    background:none; border:none; color:var(--ink); font-family:inherit;
  }
  .step button:disabled { opacity:.3; cursor:not-allowed; }
  /* Le nombre en fonte d'interface, pas en titrage : dans le Marcellus un 1
     se lit « I » et un 0 « O », ce qui va pour un code dicté à voix haute et
     pas pour un chiffre seul entre deux boutons. */
  .step .value {
    min-width:38px; text-align:center; font-family:'Inter',system-ui,sans-serif;
    font-size:17px; font-weight:700; font-variant-numeric:tabular-nums;
  }

  /* Le choix entre deux ou quatre valeurs : des segments, pas un menu —
     l'hôte doit voir d'un coup ce qui est possible. */
  .seg { display:flex; border:1px solid var(--line); background:var(--raised); }
  .seg button {
    padding:7px 13px; font-size:12.5px; font-family:inherit; cursor:pointer;
    background:none; border:none; border-right:1px solid var(--line); color:var(--ink);
  }
  .seg button:last-child { border-right:none; }
  .seg button.on { background:var(--accent); color:#F7F1E1; font-weight:600; }
  /* Sept caractères ne tiennent pas sur une ligne d'écran d'ordinateur
     portable : ceux-là s'enroulent plutôt que de déborder de la carte. */
  .seg.wrap { flex-wrap:wrap; }
  .seg.wrap button { border-bottom:1px solid var(--line); }

  .ghost {
    padding:6px 12px; font-size:11.5px; font-family:inherit; cursor:pointer;
    background:var(--raised); border:1px solid var(--line); color:var(--ink);
  }
  .ghost:hover { border-color:var(--accent); }
  .ghost:disabled { opacity:.4; cursor:not-allowed; }

  /* Ce que les réglages impliquent, dit en clair sous le pupitre : à douze
     joueurs la limite de main et le second voleur changent tout seuls, et
     personne ne devrait avoir à lire les règles pour s'en apercevoir. */
  .consequence {
    margin-top:12px; font-size:12px; line-height:1.5; color:var(--soft); text-align:left;
  }
  .consequence b { color:var(--ink); font-weight:600; }
  .locked { font-size:12.5px; color:var(--soft); text-align:left; line-height:1.6; }
  .warn { color:var(--accent); font-weight:600; }

  .seat-grid { display:flex; flex-wrap:wrap; gap:7px; justify-content:center; }
  .seat {
    background:var(--raised); border:1px solid var(--line);
    padding:6px 12px; font-size:13px; min-width:104px;
  }
  .seat.free { opacity:.45; font-style:italic; }
  .seat.bot { border-style:dashed; color:var(--soft); }
  .seat.bot .dot { background:var(--soft); }
  .seat small { font-size:10.5px; color:var(--soft); }
  .seat .dot {
    display:inline-block; width:7px; height:7px; border-radius:50%;
    background:var(--accent); margin-right:6px;
  }
  .hint { margin-top:22px; font-size:12.5px; color:var(--soft); }
${tableViewStyles()}

  /* Le lancement appartient à l'hôte : c'est lui qui voit la pièce. */
  .start { margin-top:22px; }
  .start button {
    font-family:'Inter',sans-serif; font-size:16px; font-weight:700;
    padding:13px 34px; border:1px solid transparent; cursor:pointer;
    background:var(--accent); color:#F7F1E1;
  }
  .start button:disabled { background:var(--raised); color:var(--soft); border-color:var(--line); cursor:not-allowed; }
  .start-note { margin-top:8px; font-size:12px; color:var(--soft); }
</style>
</head>
<body>
  <div class="card" id="join-panel">
    <h1>Grand Colonies</h1>
    <p class="sub">Les autres joueurs ouvrent cette adresse dans leur navigateur.</p>

    <div class="join">
      <div class="qr"><img src="${data.qrDataUrl}" alt="QR code vers la partie"></div>
      <div class="addr">
        <div class="addr-label">Adresse</div>
        <div class="addr-value">${escapeHtml(data.url)}</div>
        <div class="code">
          <div class="addr-label">Code de partie</div>
          <div class="code-value">${escapeHtml(data.code)}</div>
        </div>
      </div>
    </div>

    <section class="block" id="settings-block">
      <div class="block-head">
        <span class="title">Réglages de la partie</span>
        <button class="ghost" id="reroll" title="Tirer un autre plateau avec les mêmes réglages">
          Nouveau plateau
        </button>
      </div>
      <div class="rows" id="rows"></div>
      <p class="consequence" id="consequence"></p>
      <p class="locked" id="locked" hidden></p>
    </section>

    <section class="block">
      <div class="block-head"><span class="title">Joueurs — <span id="count">0</span> / <span id="total">—</span></span></div>
      <div class="seat-grid" id="seats"></div>
    </section>

    <div class="start">
      <button id="start" disabled>Démarrer la partie</button>
      <div class="start-note" id="start-note">En attente du premier joueur…</div>
    </div>

    <p class="hint">Un joueur qui rafraîchit sa page retrouve son siège automatiquement.</p>
  </div>

${tableViewMarkup()}

<script>
  var LIMITS = ${JSON.stringify(data.limits)};
  var settings = null;
  var bots = { count: 0, running: false, niveau: 3, caracteres: 'varie' };
  /* Niveaux et caractères des adversaires, envoyés par le serveur : les
     recopier ici en aurait fait une seconde liste, à côté de celle du
     paquet sim, avec tout le loisir de diverger. */
  var adversaires = { niveaux: [], caracteres: [] };
  var started = false;
  /**
   * Une écriture est en vol.
   *
   * Le rafraîchissement périodique et la réponse d'un réglage arrivent par
   * deux chemins : sans ce drapeau, un sondage parti avant l'envoi revenait
   * après lui et remettait l'ancienne valeur sous le doigt de l'hôte.
   */
  var pending = 0;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  }

  // ── réglages ────────────────────────────────────────────────────────

  /** Envoie ce qui change, et n'affiche que ce que le serveur a retenu. */
  async function apply(patch) {
    if (started) return;
    pending++;
    try {
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const body = await response.json();
      if (body.settings) { settings = body.settings; bots = body.bots || bots; }
      if (body.adversaires) adversaires = body.adversaires;
      renderSettings();
    } catch { /* le serveur redémarre : le prochain sondage rattrapera */ }
    finally { pending--; }
  }

  // Le pas vaut un par défaut. La taille du plateau court de 19 à 130 : à un
  // hexagone par clic, la traverser en demanderait cent onze.
  function step(label, note, value, bounds, onChange, pas) {
    const d = pas || 1;
    return '<div class="row">'
      + '<span class="label">' + label + (note ? '<small>' + note + '</small>' : '') + '</span>'
      + '<span class="step" data-step="' + onChange + '" data-pas="' + d + '">'
      +   '<button data-delta="-1"' + (value <= bounds.min ? ' disabled' : '') + '>−</button>'
      +   '<span class="value">' + value + '</span>'
      +   '<button data-delta="1"' + (value >= bounds.max ? ' disabled' : '') + '>+</button>'
      + '</span></div>';
  }

  function seg(label, note, choices, value, key, wide, wrap) {
    return '<div class="row' + (wide ? ' wide' : '') + '">'
      + '<span class="label">' + label + (note ? '<small>' + note + '</small>' : '') + '</span>'
      + '<span class="seg' + (wrap ? ' wrap' : '') + '" data-seg="' + key + '">'
      + choices.map(function (c) {
          return '<button data-value="' + c[0] + '"'
            + (String(c[0]) === String(value) ? ' class="on"' : '') + '>' + c[1] + '</button>';
        }).join('')
      + '</span></div>';
  }

  /**
   * Ce que les réglages impliquent, dit en clair.
   *
   * La limite de main et le second voleur suivent l'effectif sans qu'on les
   * demande (§24, §25) : les taire ferait passer pour un bug ce qui est une
   * règle. Les places humaines restantes sont le chiffre qu'on cherche
   * vraiment en posant des bots.
   */
  function consequences() {
    const humans = settings.playerCount - bots.count;
    const handLimit = settings.playerCount <= 7 ? 7 : Math.min(13, settings.playerCount + 1);
    const parts = [];
    // Plus une seule place humaine, c'est presque toujours une main qui a
    // glissé : autant de bots que de sièges se lit mal dans deux molettes
    // côte à côte, et se voit tout de suite ici.
    parts.push(humans === 0
      ? '<span class="warn">aucune place pour un joueur réel</span>'
      : '<b>' + humans + '</b> place' + (humans > 1 ? 's' : '') + ' pour des joueurs réels');
    parts.push('limite de main <b>' + handLimit + '</b>');
    if (settings.playerCount >= 11) parts.push('<b>deux voleurs</b>');
    if (settings.playerCount < 8 && settings.landCount === 19) {
      parts.push('plateau classique — les dix-neuf tuiles d’origine');
    } else if (settings.playerCount < 8) {
      parts.push('plateau généré — l’archipel est prévu pour huit joueurs et plus');
    }
    else if (settings.boardKind === 'disc') parts.push('partie plus courte qu’en archipel');
    /*
     * Ce que l'échelle change vraiment, mesuré en simulation.
     *
     * On s'attendait à des parties plus longues ; c'est l'inverse. À douze
     * joueurs sur quarante-huit terres, la table est engorgée — on se bloque
     * les emplacements. De la place, et chacun construit.
     */
    const ratio = settings.balanced ? settings.landCount / settings.balanced : 1;
    if (ratio >= 2) {
      parts.push('terres <b>doublées</b> — parties nettement plus courtes, plus de routes en réserve');
    } else if (ratio > 1.25) {
      parts.push('terres <b>agrandies</b> — plus de place, moins d’emplacements disputés');
    } else if (ratio < 0.8) {
      parts.push('terres <b>resserrées</b> — emplacements très disputés, production concentrée');
    }
    /*
     * Ce qu'un niveau élevé fait à la soirée, mesuré et non supposé.
     *
     * Quarante-huit parties à six joueurs : 192 cycles pour une table de
     * colons, 209 pour une table de stratèges. Des adversaires forts avancent
     * tous ensemble, le plateau se remplit, et c'est la place — pas le
     * talent — qui décide alors de la durée.
     */
    if (bots.count > 0 && bots.niveau >= 4) {
      parts.push('adversaires <b>redoutables</b> — parties un peu plus longues, prévois de la place');
    }
    if (bots.error) parts.push('<span class="warn">' + escapeHtml(bots.error) + '</span>');
    return parts.join(' · ') + '.';
  }

  /**
   * Ce que vaut la taille choisie, rapportée à celle qui équilibre l'effectif.
   *
   * Le nombre seul ne dit rien : soixante terres sont vastes à quatre joueurs
   * et serrées à douze. L'écart au §4 est ce qui se lit d'un coup d'œil, et
   * c'est le serveur qui fournit la référence — la recalculer ici en aurait
   * fait une seconde vérité, à côté de baseLandCount.
   */
  function tailleNote() {
    const base = settings.balanced;
    if (!base) return 'hexagones de terre';
    const ecart = Math.round((settings.landCount / base) * 100);
    if (ecart >= 95 && ecart <= 105) return 'hexagones · équilibre du jeu pour ' + settings.playerCount + ' joueurs';
    return 'hexagones · ' + (ecart > 105 ? 'vaste' : 'serré')
      + ' — l’équilibre à ' + settings.playerCount + ' joueurs est ' + base;
  }

  /**
   * Niveau et caractères, montrés seulement quand il y a des adversaires.
   *
   * Deux lignes de plus dans un pupitre qui en compte huit, pour un réglage
   * qui ne veut rien dire à zéro bot : elles n'apparaissent qu'une fois la
   * molette bougée, et disparaissent si on la ramène à zéro.
   */
  function reglagesAdversaires() {
    if (bots.count === 0 || adversaires.niveaux.length === 0) return '';

    const niveaux = adversaires.niveaux.map(function (n) { return [n.id, n.id + ' · ' + n.nom]; });
    const courant = adversaires.niveaux.filter(function (n) { return n.id === bots.niveau; })[0];

    const caracteres = [['varie', 'Variés']].concat(
      adversaires.caracteres.map(function (c) { return [c.id, c.nom]; }));

    return seg('Niveau', courant ? courant.description : 'de l’apprenti au stratège',
               niveaux, bots.niveau, 'botNiveau', true)
      + seg('Caractères', 'variés : chacun le sien, à tour de rôle',
            caracteres, bots.caracteres, 'botCaractere', true, true);
  }

  function renderSettings() {
    if (!settings) return;
    document.getElementById('total').textContent = settings.playerCount;

    if (started) {
      document.getElementById('rows').hidden = true;
      document.getElementById('consequence').hidden = true;
      document.getElementById('reroll').disabled = true;
      const locked = document.getElementById('locked');
      locked.hidden = false;
      locked.innerHTML = settings.playerCount + ' joueurs · '
        + (settings.boardKind === 'disc' ? 'disque' : 'archipel')
        + ' de ' + settings.landCount + ' terres · '
        + settings.victoryTarget + ' points · tour de ' + settings.activeTurnSeconds + ' s'
        + (bots.count ? ' · ' + bots.count + ' adversaires niveau ' + bots.niveau : '')
        + '<br>Les réglages sont figés une fois la partie lancée.';
      return;
    }

    document.getElementById('rows').innerHTML =
        step('Joueurs', 'sièges à la table', settings.playerCount, LIMITS.playerCount, 'playerCount')
      + step('Adversaires automatiques', 'ils prennent les sièges libres', bots.count,
             { min: 0, max: settings.playerCount }, 'bots')
      + reglagesAdversaires()
      + seg('Plateau', 'huit joueurs et plus', [['archipelago','Archipel'],['disc','Disque']],
            settings.boardKind, 'boardKind')
      + step('Taille du plateau', tailleNote(), settings.landCount, LIMITS.landCount, 'landCount', 4)
      + seg('Victoire', 'points à atteindre', [[10,'10'],[12,'12'],[15,'15'],[18,'18']],
            settings.victoryTarget, 'victoryTarget')
      + seg('Mise en place', 'secondes par pose', [[20,'20 s'],[30,'30 s'],[45,'45 s'],[60,'60 s']],
            settings.setupSeconds, 'setupSeconds', true)
      + seg('Tour', 'secondes par joueur actif', [[45,'45 s'],[60,'60 s'],[90,'90 s'],[120,'120 s']],
            settings.activeTurnSeconds, 'activeTurnSeconds', true)
      + seg('Commerce', 'fenêtre après chaque tour', [[0,'aucune'],[20,'20 s'],[30,'30 s'],[45,'45 s']],
            settings.tradingWindowSeconds, 'tradingWindowSeconds', true);
    document.getElementById('consequence').innerHTML = consequences();
  }

  document.getElementById('rows').addEventListener('click', function (event) {
    const button = event.target.closest('button');
    if (!button || button.disabled || !settings) return;

    const stepper = button.closest('[data-step]');
    if (stepper) {
      const key = stepper.dataset.step;
      const delta = Number(button.dataset.delta) * Number(stepper.dataset.pas || 1);
      if (key === 'bots') apply({ bots: bots.count + delta });
      else {
        const next = {};
        next[key] = settings[key] + delta;
        // Réduire l'effectif sous le nombre de bots les laisserait tout
        // occuper : ils descendent avec lui.
        if (key === 'playerCount') next.bots = Math.min(bots.count, next[key]);
        apply(next);
      }
      return;
    }

    const segment = button.closest('[data-seg]');
    if (segment) {
      const key = segment.dataset.seg;
      const raw = button.dataset.value;
      const next = {};
      next[key] = isNaN(Number(raw)) ? raw : Number(raw);
      apply(next);
    }
  });

  document.getElementById('reroll').addEventListener('click', function () {
    apply({ newBoard: true });
  });

  // ── sièges et lancement ─────────────────────────────────────────────

  async function refresh() {
    try {
      const [seats, state] = await Promise.all([
        (await fetch('/api/seats')).json(),
        (await fetch('/api/settings')).json(),
      ]);
      if (pending === 0) {
        settings = state.settings;
        bots = state.bots || bots;
        if (state.adversaires) adversaires = state.adversaires;
        // Dans les deux sens : une partie rouverte doit rendre au bouton
        // son libellé et aux réglages leurs molettes, sans recharger.
        if (state.started !== started) {
          started = state.started;
          if (started) markStarted(); else reopen();
        }
        renderSettings();
      }
      const taken = seats.filter(function (s) { return s.connected; });
      document.getElementById('count').textContent = String(taken.length);
      updateStart(taken.length, seats.length);
      document.getElementById('seats').innerHTML = seats.map(function (seat) {
        if (!seat.connected) return '<div class="seat free">libre</div>';
        // Le trait pointillé distingue un adversaire automatique : dix
        // sièges pleins dont neuf de bots ne se lisent pas autrement, et
        // c'est pourtant ce que l'hôte cherche à savoir avant de lancer.
        return '<div class="seat' + (seat.bot ? ' bot' : '') + '">'
          + '<span class="dot"></span>' + escapeHtml(seat.name)
          + (seat.bot ? '<small> · auto</small>' : '') + '</div>';
      }).join('');
    } catch { /* le serveur redémarre : on réessaiera au prochain tour */ }
  }

  /**
   * Le bouton ne s'active qu'avec au moins un joueur, et l'hôte reste libre
   * de lancer sans attendre les retardataires : leurs sièges seront joués
   * par défaut, et restent disponibles s'ils arrivent en cours de route.
   */
  function updateStart(taken, total) {
    const button = document.getElementById('start');
    const note = document.getElementById('start-note');
    if (started) return;
    button.disabled = taken === 0;
    note.textContent = taken === 0
      ? 'En attente du premier joueur…'
      : taken < total
        ? taken + ' sur ' + total + ' — tu peux lancer sans attendre les autres.'
        : 'Tout le monde est là.';
  }

  /** Retour au salon : le bouton redevient un départ, les réglages s'ouvrent. */
  function reopen() {
    const button = document.getElementById('start');
    button.textContent = 'Démarrer la partie';
    document.getElementById('rows').hidden = false;
    document.getElementById('consequence').hidden = false;
    document.getElementById('locked').hidden = true;
    document.getElementById('reroll').disabled = false;
  }

  function markStarted() {
    const button = document.getElementById('start');
    button.disabled = true;
    button.textContent = 'Partie en cours';
    document.getElementById('start-note').textContent = 'Bonne partie.';
  }

  document.getElementById('start').addEventListener('click', async function () {
    document.getElementById('start').disabled = true;
    await fetch('/api/start', { method: 'POST' });
    started = true;
    markStarted();
    renderSettings();
  });

  refresh();
  setInterval(refresh, 1500);
${tableViewScript()}
</script>
</body>
</html>`;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
}
