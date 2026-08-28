import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.jsx';
import './styles.css';

/**
 * Le serveur à joindre.
 *
 * Par défaut celui qui sert la page, sur le port de jeu. Un paramètre
 * `?serveur=hôte:port` permet d'en viser un autre — utile pour ouvrir une
 * seconde partie sans toucher à celle qui tourne, et pour un poste qui
 * hébergerait le client sans héberger le jeu.
 */
function serverUrl(): string {
  const asked = new URLSearchParams(location.search).get('serveur');
  if (asked) return asked.startsWith('ws') ? asked : `ws://${asked}`;
  return `ws://${location.hostname}:2567`;
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<StrictMode><App url={serverUrl()} /></StrictMode>);
