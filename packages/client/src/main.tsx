import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.jsx';
import { serverUrl } from './net/serverUrl.js';
import './styles.css';

const root = document.getElementById('root');
if (root) createRoot(root).render(<StrictMode><App url={serverUrl()} /></StrictMode>);
