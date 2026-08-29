/**
 * L'écran de table : le plateau et les joueurs, pour la pièce entière.
 *
 * Une fois la partie lancée, l'écran de l'hôte n'a plus rien à faire d'un QR
 * code. Il devient le plateau commun — celui qu'on regarde quand on cherche
 * qui mène, où en est le voleur, ou combien de cartes tient son voisin.
 *
 * **Ce qu'il ne montre pas, et pourquoi.** Le détail des mains n'est plus un
 * secret — la vue publique le porte désormais, ressource par ressource — mais
 * cet écran s'en tient au **nombre** de cartes. Ce n'est plus une question
 * d'étanchéité, c'est une question de place : la colonne des joueurs tient
 * douze lignes lisibles à trois mètres, et y ajouter sept quantités par
 * joueur les rendrait toutes illisibles. Qui veut le détail le lit sur son
 * propre écran, où il tient.
 *
 * Le plateau est dessiné en SVG plutôt qu'en tuiles texturées : à cette
 * taille et à trois mètres, un aplat lisible vaut mieux qu'une image détaillée
 * — et l'écran hôte vit sur un autre port que le client, donc n'a pas accès à
 * ses images.
 */

/** Teintes des terrains, dans la palette Céramique. */
export const TERRAIN_COLORS: Readonly<Record<string, string>> = {
  forest: '#4A6B3A',
  pasture: '#8CA05E',
  field: '#D2A73E',
  hills: '#B4643A',
  mountain: '#8A8F98',
  desert: '#E0CFA2',
  gold: '#C9A227',
  fish: '#5E93A6',
  sea: '#3C5A78',
  unexplored: '#5B5348',
};

/**
 * Ce qu'un port annonce, en deux lignes (§11).
 *
 * L'écran de table se lit à trois mètres : le taux en gros, la marchandise
 * en petit. Les trois ports à contrat ne se distinguent pas par leur taux —
 * il vaut deux comme celui d'un port spécialisé — mais par leur seconde
 * ligne, qui porte l'échange en toutes lettres.
 */
export const PORT_LABELS: Readonly<Record<string, { rate: string; goods: string }>> = {
  generic: { rate: '3:1', goods: 'Tout' },
  wood: { rate: '2:1', goods: 'Bois' },
  brick: { rate: '2:1', goods: 'Argile' },
  wool: { rate: '2:1', goods: 'Laine' },
  grain: { rate: '2:1', goods: 'Blé' },
  ore: { rate: '2:1', goods: 'Minerai' },
  merchant: { rate: '2:1', goods: 'Marchand' },
  mining: { rate: '2→1', goods: 'Minerai → Or' },
  commercial: { rate: '2→1', goods: 'Deux sortes' },
  // Le port royal ne commerce pas : il paie en Influence (§17). Son panneau
  // ne porte donc pas de taux — en afficher un ferait croire à un échange.
  royal: { rate: '👑', goods: 'Influence' },
};

/** Les ports à contrat du §11 : ils ne remisent pas le cours, ils s'y soustraient. */
export const CONTRACT_PORT_KINDS: readonly string[] = ['merchant', 'mining', 'commercial'];

/** Les mêmes douze couleurs que le client, dans le même ordre. */
export const PLAYER_COLORS: readonly string[] = [
  '#A63A17', '#2D6E8E', '#5F7038', '#B8862B', '#7B3457', '#2E8B7A',
  '#3B4F91', '#C4692A', '#6B3F8F', '#2F7A4A', '#7A4A2E', '#3A3A3A',
];

/**
 * Le fragment de page — styles, structure et script.
 *
 * Rendu en chaîne plutôt qu'assemblé par un cadriciel : l'écran de l'hôte est
 * une page unique servie par le serveur de jeu, sans étape de construction.
 */
export function tableViewMarkup(): string {
  return `
  <section id="table" class="table" hidden>
    <header class="table-head">
      <div class="table-phase"><span id="t-cycle"></span> · <span id="t-phase"></span></div>
      <div class="table-turn"><span id="t-active"></span></div>
      <div class="table-roll" id="t-roll"></div>
      <!-- La piste barbare : elle concerne toute la table d'un coup, donc
           elle vit dans l'en-tête commun et non sur une fiche de joueur. -->
      <div class="table-barb" id="t-barb"></div>
      <!-- Le retour aux réglages : discret pendant la partie, franc une fois
           qu'elle est finie, parce que c'est là qu'on veut en relancer une. -->
      <!-- Les gestes d'une soirée réelle : suspendre, rallonger, refaire. -->
      <button class="table-again" id="t-pause">Pause</button>
      <button class="table-again" id="t-extend">+30 s</button>
      <button class="table-again" id="t-again">Nouvelle partie</button>
    </header>

    <div class="table-veil" id="t-veil" hidden>Partie en pause</div>

    <div class="table-body">
      <div class="table-board"><svg id="t-svg" role="img" aria-label="Plateau"></svg></div>
      <aside class="table-players" id="t-players"></aside>
    </div>
  </section>`;
}

export function tableViewStyles(): string {
  return `
  .table { position:relative; z-index:1; width:min(1600px,100%); }
  .table-head {
    display:flex; align-items:baseline; gap:20px; justify-content:center;
    margin-bottom:14px; color:var(--ink);
  }
  .table-phase {
    font-size:12px; letter-spacing:.14em; text-transform:uppercase; color:var(--soft);
  }
  .table-turn { font-family:'Marcellus',Georgia,serif; font-size:30px; }
  .table-roll {
    font-family:'Marcellus',Georgia,serif; font-size:22px; color:var(--accent);
    min-width:96px; text-align:right;
  }
  .table-barb {
    font-family:'Inter',sans-serif; font-size:11px; color:var(--soft);
    display:flex; align-items:center; gap:7px; letter-spacing:.08em;
  }
  .table-barb b { font-family:'Marcellus',Georgia,serif; font-size:15px; letter-spacing:0; }
  .barb-track { display:flex; gap:3px; }
  .barb-cell { width:9px; height:9px; background:var(--line); border-radius:1px; }
  .barb-cell.on { background:var(--accent); }
  /* La dernière case est la mort : elle se signale avant d'être atteinte. */
  .barb-cell.last { background:#8B2E2E; }
  /* Défense insuffisante : la table est à découvert, et doit le savoir. */
  .table-barb.is-weak b { color:#B4432B; }

  .table-again {
    font-family:'Inter',sans-serif; font-size:12px; font-weight:600; cursor:pointer;
    padding:7px 13px; background:var(--raised); border:1px solid var(--line); color:var(--soft);
  }
  .table-again:hover { border-color:var(--accent); color:var(--ink); }
  /* Partie terminée : ce n'est plus une sortie de secours, c'est la suite. */
  .table-again.is-done {
    background:var(--accent); color:#F7F1E1; border-color:transparent; font-size:14px;
    padding:10px 20px;
  }

  /* En pause, le bouton cesse d'être discret : c'est l'état à quitter. */
  .table-again.is-paused {
    background:var(--accent); color:#F7F1E1; border-color:transparent;
  }
  /*
   * Le voile de pause.
   *
   * Vu de trois mètres, un bouton qui change de couleur ne se remarque pas.
   * Il faut que la pièce entière comprenne d'un regard pourquoi plus rien ne
   * bouge, sans quoi chacun cherche la panne de son côté.
   */
  .table-veil {
    position:fixed; inset:0; z-index:5; display:flex;
    align-items:center; justify-content:center;
    background:rgba(24,20,14,.72); backdrop-filter:blur(2px);
    font-family:'Marcellus',Georgia,serif; font-size:56px; color:#F7F1E1;
    letter-spacing:.06em;
  }

  .player-bot {
    font-family:'Inter',sans-serif; font-size:11px; cursor:pointer; margin-top:4px;
    padding:3px 8px; background:var(--accent); color:#F7F1E1; border:none;
  }
  .player-bot:disabled { opacity:.5; cursor:default; }

  .table-body { display:flex; gap:18px; align-items:flex-start; }
  .table-board {
    flex:1; min-width:0; background:rgba(233,220,190,.9);
    border:1px solid var(--line); padding:10px; box-shadow:0 4px 24px rgba(30,20,10,.2);
    display:flex; justify-content:center;
  }
  /* Le plateau tient dans l'écran sans défilement : à douze joueurs il fait
     cent soixante-dix hexagones, et un écran de table qu'il faut faire
     défiler ne sert à rien — personne ne va toucher la souris de l'hôte. */
  .table-board svg { display:block; max-width:100%; max-height:80vh; height:auto; }

  .table-players {
    width:330px; flex:none; display:grid; gap:6px;
    max-height:78vh; overflow-y:auto;
  }
  .player-card {
    background:rgba(233,220,190,.94); border:1px solid var(--line);
    padding:8px 10px; display:grid; grid-template-columns:auto 1fr auto; gap:8px;
    align-items:center;
  }
  /* Le joueur actif se repère d'un coup d'œil depuis le fond de la pièce. */
  .player-card.is-active { border-color:var(--accent); border-width:2px; padding:7px 9px; }
  .player-card.is-away { opacity:.45; }
  .player-dot { width:15px; height:15px; border:1px solid rgba(27,19,16,.35); }
  .player-name {
    font-size:15px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  }
  .player-role {
    font-size:9px; letter-spacing:.1em; text-transform:uppercase;
    color:var(--accent); margin-left:6px;
  }
  .player-score { font-family:'Marcellus',Georgia,serif; font-size:24px; text-align:right; }
  .player-score small { display:block; font-family:'Inter',sans-serif; font-size:9px; color:var(--soft); }
  .player-meta {
    grid-column:1 / -1; display:flex; gap:10px; flex-wrap:wrap;
    font-size:10.5px; color:var(--soft);
  }
  .player-meta b { color:var(--ink); font-variant-numeric:tabular-nums; }
  .player-title { color:var(--accent); font-weight:600; }
  .player-warn { color:var(--danger); font-weight:600; }

  @media (max-width:1100px) {
    .table-body { flex-direction:column; }
    .table-players { width:100%; max-height:none; grid-template-columns:repeat(2,1fr); }
  }`;
}

export function tableViewScript(): string {
  return `
  const TERRAIN = ${JSON.stringify(TERRAIN_COLORS)};
  const COLORS = ${JSON.stringify(PLAYER_COLORS)};
  const PORTS = ${JSON.stringify(PORT_LABELS)};
  const CONTRACTS = ${JSON.stringify(CONTRACT_PORT_KINDS)};
  const SIZE = 26;

  const hexCenter = (id) => {
    const [q, r] = id.split(',').map(Number);
    return { x: SIZE * Math.sqrt(3) * (q + r / 2), y: SIZE * 1.5 * r };
  };
  /** Barycentre des hexagones nommés par une clé de sommet ou d'arête. */
  const centroid = (key) => {
    const pts = key.split('|').map(hexCenter);
    return {
      x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
      y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
    };
  };
  const hexPoints = (c) => Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (60 * i - 30);
    return (c.x + SIZE * Math.cos(a)).toFixed(1) + ',' + (c.y + SIZE * Math.sin(a)).toFixed(1);
  }).join(' ');

  /**
   * Le panneau d'un port, poussé vers l'eau que touche son sommet.
   *
   * Un sommet est le trio d'hexagones qui s'y rejoignent : il suffit de
   * regarder lesquels sont de la mer et de pousser le panneau dans leur
   * direction. Pousser « vers l'extérieur du plateau » marche sur une côte
   * convexe et enfonce le panneau sous la terre voisine dès que la côte
   * rentre — et un archipel n'est fait que de côtes qui rentrent.
   */
  const portAnchor = (vertex, seas) => {
    const c = centroid(vertex);
    const water = vertex.split('|').filter((id) => seas.has(id)).map(hexCenter);
    if (water.length === 0) return c;
    const mx = water.reduce((s, p) => s + p.x, 0) / water.length - c.x;
    const my = water.reduce((s, p) => s + p.y, 0) / water.length - c.y;
    const n = Math.hypot(mx, my) || 1;
    return { x: c.x + (mx / n) * SIZE * 0.95, y: c.y + (my / n) * SIZE * 0.95 };
  };

  const colorOf = (id, order) => COLORS[Math.max(0, order.indexOf(id)) % COLORS.length];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);

  function drawBoard(view) {
    const order = view.players.map((p) => p.id);
    const parts = [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (const hex of view.hexes) {
      const c = hexCenter(hex.id);
      minX = Math.min(minX, c.x - SIZE); maxX = Math.max(maxX, c.x + SIZE);
      minY = Math.min(minY, c.y - SIZE); maxY = Math.max(maxY, c.y + SIZE);
      const fill = TERRAIN[hex.terrain] || '#999';
      parts.push('<polygon points="' + hexPoints(c) + '" fill="' + fill + '" stroke="rgba(27,19,16,.18)" stroke-width="1"/>');
      // Le voleur assombrit sa tuile : il doit se voir sans qu'on lise rien.
      if (hex.blocked) parts.push('<polygon points="' + hexPoints(c) + '" fill="rgba(20,14,10,.55)"/>');
      if (hex.token !== undefined && hex.token !== null) {
        const hot = hex.token === 6 || hex.token === 8;
        parts.push('<circle cx="' + c.x + '" cy="' + c.y + '" r="10.5" fill="#F4ECD8" stroke="rgba(27,19,16,.3)"/>');
        parts.push('<text x="' + c.x + '" y="' + (c.y + 4.5) + '" text-anchor="middle" font-size="13" font-weight="700" fill="' +
          (hot ? '#A63A17' : '#1B1310') + '">' + hex.token + '</text>');
      }
    }

    /*
     * Les ports, sur l'eau qui borde leur sommet.
     *
     * Ils manquaient à cet écran, alors qu'ils sont des positions de course :
     * on ne négocie pas de la même façon selon qui tient le port marchand, et
     * c'est ici que la table le lit. Dessinés après les tuiles et avant les
     * pièces, pour qu'une colonie posée sur un port reste au-dessus de lui.
     */
    const seas = new Set(view.hexes.filter((h) => h.terrain === 'sea').map((h) => h.id));
    for (const port of view.ports || []) {
      const sign = PORTS[port.kind] || { rate: '2:1', goods: port.kind };
      const a = portAnchor(port.vertex, seas);
      minX = Math.min(minX, a.x - 24); maxX = Math.max(maxX, a.x + 24);
      minY = Math.min(minY, a.y - 14); maxY = Math.max(maxY, a.y + 14);
      // Les ports à contrat portent la couleur d'accent : il n'y en a qu'un
      // de chaque sur le plateau, et leur taux seul ne les distingue pas.
      const rare = CONTRACTS.indexOf(port.kind) >= 0;
      parts.push('<rect x="' + (a.x - 22) + '" y="' + (a.y - 12) + '" width="44" height="24" rx="4" fill="' +
        (rare ? '#8C5A2B' : '#6B5640') + '" stroke="' + (rare ? '#F0D9A8' : 'rgba(20,14,10,.55)') +
        '" stroke-width="1.2"/>');
      parts.push('<text x="' + a.x + '" y="' + (a.y - 1) + '" text-anchor="middle" font-size="11" ' +
        'font-weight="700" fill="#F7F1E1">' + esc(sign.rate) + '</text>');
      parts.push('<text x="' + a.x + '" y="' + (a.y + 9) + '" text-anchor="middle" font-size="' +
        (sign.goods.length > 8 ? 6 : 7.5) + '" fill="#F0E4CC">' + esc(sign.goods) + '</text>');
    }

    for (const road of view.roads) {
      const m = centroid(road.edge);
      const [a, b] = road.edge.split('|').map(hexCenter);
      const angle = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI + 90;
      const dash = road.kind === 'maritime' ? ' stroke-dasharray="5 3"' : '';
      parts.push('<rect x="' + (m.x - 13) + '" y="' + (m.y - 3.5) + '" width="26" height="7" rx="1.5" fill="' +
        colorOf(road.owner, order) + '" stroke="rgba(27,19,16,.5)" stroke-width="1"' + dash +
        ' transform="rotate(' + angle.toFixed(1) + ' ' + m.x + ' ' + m.y + ')"/>');
    }

    for (const b of view.buildings) {
      const c = centroid(b.vertex);
      const fill = colorOf(b.owner, order);
      const size = b.kind === 'settlement' ? 9 : 12;
      parts.push('<rect x="' + (c.x - size / 2) + '" y="' + (c.y - size / 2) + '" width="' + size +
        '" height="' + size + '" fill="' + fill + '" stroke="#1B1310" stroke-width="1.4"' +
        (b.kind === 'metropolis' ? ' transform="rotate(45 ' + c.x + ' ' + c.y + ')"' : '') + '/>');
    }

    const svg = document.getElementById('t-svg');
    const pad = 8;
    svg.setAttribute('viewBox', (minX - pad) + ' ' + (minY - pad) + ' ' +
      (maxX - minX + pad * 2) + ' ' + (maxY - minY + pad * 2));
    svg.innerHTML = parts.join('');
  }

  const PHASES = {
    setup:'Mise en place', production:'Production', activeTurn:'Tour',
    freeTrade:'Commerce libre', ended:'Partie terminée',
  };

  function drawPlayers(view, seats) {
    const order = view.players.map((p) => p.id);
    // Un siège abandonné depuis deux tours de table : la partie l'attend en
    // vain, cycle après cycle, et rien ne le signalait à l'hôte.
    const perdus = {};
    (seats || []).forEach((s) => { if (s.abandoned) perdus[s.playerId] = true; });
    document.getElementById('t-players').innerHTML = view.players.map((p) => {
      const titles = [];
      if (p.hasMonument) titles.push('Monument');
      const role = p.role === 'active' ? '<span class="player-role">actif</span>'
        : p.role === 'paired' ? '<span class="player-role">associé</span>' : '';
      return '<div class="player-card' + (p.role === 'active' ? ' is-active' : '') +
        (p.connected ? '' : ' is-away') + '">' +
        '<span class="player-dot" style="background:' + colorOf(p.id, order) + '"></span>' +
        '<span class="player-name">' + esc(p.name) + role + '</span>' +
        '<span class="player-score">' + p.publicPoints + '<small>points</small></span>' +
        '<span class="player-meta">' +
          '<span><b>' + p.handSize + '</b> cartes</span>' +
          '<span><b>' + p.devCardCount + '</b> dév.</span>' +
          '<span><b>' + p.knightsPlayed + '</b> chevaliers</span>' +
          '<span><b>' + p.roadsLeft + '</b> routes</span>' +
          (titles.length ? '<span class="player-title">' + titles.join(' · ') + '</span>' : '') +
          (p.mustDiscard > 0 ? '<span class="player-warn">défausse ' + p.mustDiscard + '</span>' : '') +
          (p.connected ? '' : '<span>absent</span>') +
          (perdus[p.id]
            ? '<button class="player-bot" data-seat="' + p.id + '">Confier à un bot</button>'
            : '') +
        '</span></div>';
    }).join('');
  }

  async function refreshTable() {
    try {
      const [view, seats] = await Promise.all([
        (await fetch('/api/view')).json(),
        (await fetch('/api/seats')).json(),
      ]);
      const join = document.getElementById('join-panel');
      const table = document.getElementById('table');
      // Avant le lancement, l'écran sert à faire entrer les joueurs ; après,
      // à suivre la partie. Le basculement est automatique.
      join.hidden = view.started;
      table.hidden = !view.started;
      if (!view.started) return;

      document.getElementById('t-cycle').textContent = 'Cycle ' + view.cycle;
      document.getElementById('t-phase').textContent = PHASES[view.phase] || view.phase;
      const active = view.players.find((p) => p.id === view.activePlayer);
      document.getElementById('t-active').textContent = view.winner
        ? (view.players.find((p) => p.id === view.winner)?.name ?? '') + ' l\\'emporte'
        : active ? 'Au tour de ' + active.name : '—';
      document.getElementById('t-roll').textContent = view.lastRoll
        ? view.lastRoll.a + ' + ' + view.lastRoll.b + ' = ' + view.lastRoll.total : '';

      const again = document.getElementById('t-again');
      again.classList.toggle('is-done', Boolean(view.winner));
      again.textContent = view.winner ? 'Nouvelle partie' : 'Abandonner et refaire';

      // La pause n'a plus lieu d'être une fois la partie gagnée : il ne reste
      // rien à suspendre, et les deux boutons n'y mèneraient qu'à confusion.
      const pause = document.getElementById('t-pause');
      const extend = document.getElementById('t-extend');
      pause.hidden = Boolean(view.winner);
      extend.hidden = Boolean(view.winner) || view.paused;
      pause.textContent = view.paused ? 'Reprendre' : 'Pause';
      pause.classList.toggle('is-paused', Boolean(view.paused));
      document.getElementById('t-veil').hidden = !view.paused;

      /*
       * La menace, et ce qu'elle coûterait maintenant.
       *
       * On affiche défense/force plutôt que la seule position sur la piste :
       * savoir que les barbares approchent n'aide pas si l'on ignore si la
       * table tiendra. C'est ce rapport qui décide un joueur à sortir un
       * chevalier plutôt qu'à le garder pour la puissance militaire.
       */
      const b = view.barbarians;
      if (b) {
        const cells = [];
        for (let i = 0; i < b.trackLength; i++) {
          const dernier = i === b.trackLength - 1;
          cells.push('<span class="barb-cell' + (i < b.progress ? ' on' : '')
            + (dernier ? ' last' : '') + '"></span>');
        }
        const barb = document.getElementById('t-barb');
        barb.classList.toggle('is-weak', b.defence < b.strength);
        barb.innerHTML = '<span>BARBARES</span><span class="barb-track">' + cells.join('')
          + '</span><b>' + b.defence + '/' + b.strength + '</b>';
      }

      drawBoard(view);
      drawPlayers(view, seats);
    } catch { /* le serveur redémarre : on réessaiera */ }
  }

  /*
   * Une partie en cours ne se jette pas par mégarde.
   *
   * Terminée, la confirmation n'aurait aucun sens — il n'y a plus rien à
   * perdre et c'est le geste qu'on attend.
   */
  document.getElementById('t-again').addEventListener('click', async () => {
    const done = document.getElementById('t-again').classList.contains('is-done');
    if (!done && !confirm('Abandonner la partie en cours et revenir aux réglages ?')) return;
    await fetch('/api/new', { method: 'POST' });
    // Le basculement suit l'indicateur de lancement : le rafraîchissement
    // suivant ramène l'écran des réglages tout seul.
    document.getElementById('t-players').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-seat]');
    if (!button) return;
    button.disabled = true;
    await fetch('/api/handToBot', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerId: button.dataset.seat }),
    });
    refreshTable();
  });

  document.getElementById('t-pause').addEventListener('click', async () => {
    const paused = document.getElementById('t-pause').classList.contains('is-paused');
    await fetch(paused ? '/api/resume' : '/api/pause', { method: 'POST' });
    refreshTable();
  });

  document.getElementById('t-extend').addEventListener('click', async () => {
    await fetch('/api/extend', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ seconds: 30 }),
    });
    refreshTable();
  });

  refreshTable();
  });

  refreshTable();
  setInterval(refreshTable, 1500);`;
}
