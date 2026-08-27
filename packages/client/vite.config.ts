import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    // Écoute sur toutes les interfaces : les invités se connectent depuis
    // leur téléphone, pas depuis le PC hôte.
    host: true,
    port: 5173,
  },
});
