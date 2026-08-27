/**
 * Écran de l'hôte.
 *
 * C'est la première chose qu'on regarde le soir de la partie, et souvent
 * debout, en montrant l'écran à la ronde. Sa hiérarchie est donc inversée par
 * rapport à une page classique : le QR code et l'adresse écrasent tout le
 * reste, parce que le premier obstacle d'une soirée n'est pas le jeu mais
 * « comment je me connecte ».
 *
 * La liste des sièges se rafraîchit seule, pour que l'hôte voie ses invités
 * arriver sans toucher à rien.
 */

export interface HostPageData {
  readonly url: string;
  readonly code: string;
  readonly qrDataUrl: string;
  readonly playerCount: number;
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
    --ink:#1B1310; --soft:#5E4A38; --accent:#A63A17;
  }
  * { box-sizing:border-box; margin:0; padding:0; }
  body {
    background:var(--bg); color:var(--ink); font-family:'Inter',system-ui,sans-serif;
    min-height:100vh; display:grid; place-items:center; padding:28px;
  }
  .card { width:min(760px,100%); text-align:center; }
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

  .seats { margin-top:30px; border-top:1px solid var(--line); padding-top:18px; }
  .seats-head {
    font-size:11px; letter-spacing:.12em; text-transform:uppercase; color:var(--soft); margin-bottom:10px;
  }
  .seat-grid { display:flex; flex-wrap:wrap; gap:7px; justify-content:center; }
  .seat {
    background:var(--raised); border:1px solid var(--line);
    padding:6px 12px; font-size:13px; min-width:104px;
  }
  .seat.free { opacity:.45; font-style:italic; }
  .seat .dot {
    display:inline-block; width:7px; height:7px; border-radius:50%;
    background:var(--accent); margin-right:6px;
  }
  .hint { margin-top:22px; font-size:12.5px; color:var(--soft); }

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
  <div class="card">
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

    <div class="seats">
      <div class="seats-head">Joueurs — <span id="count">0</span> / ${data.playerCount}</div>
      <div class="seat-grid" id="seats"></div>
    </div>

    <div class="start">
      <button id="start" disabled>Démarrer la partie</button>
      <div class="start-note" id="start-note">En attente du premier joueur…</div>
    </div>

    <p class="hint">Un joueur qui rafraîchit sa page retrouve son siège automatiquement.</p>
  </div>

<script>
  // Rafraîchissement discret : l'hôte voit ses invités arriver sans rien faire.
  let started = false;

  async function refresh() {
    try {
      const seats = await (await fetch('/api/seats')).json();
      const taken = seats.filter(s => s.connected);
      document.getElementById('count').textContent = String(taken.length);
      updateStart(taken.length, seats.length);
      document.getElementById('seats').innerHTML = seats.map(seat =>
        seat.connected
          ? '<div class="seat"><span class="dot"></span>' + escapeHtml(seat.name) + '</div>'
          : '<div class="seat free">libre</div>'
      ).join('');
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

  document.getElementById('start').addEventListener('click', async () => {
    const button = document.getElementById('start');
    button.disabled = true;
    await fetch('/api/start', { method: 'POST' });
    started = true;
    button.textContent = 'Partie en cours';
    document.getElementById('start-note').textContent = 'Bonne partie.';
  });

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
  }
  refresh();
  setInterval(refresh, 1500);
</script>
</body>
</html>`;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
}
