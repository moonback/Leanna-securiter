import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import monacoEditorPlugin from 'vite-plugin-monaco-editor';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const configuredPort = Number(env.VITE_SERVER_PORT || process.env.VITE_SERVER_PORT);

  return {
    plugins: [
      react(),
      tailwindcss(),
      // Copie les workers Monaco en local — nécessaire sous Electron
      // (évite le chargement CDN qui échoue avec nodeIntegration: true)
      (monacoEditorPlugin as any).default({
        languageWorkers: ['editorWorkerService', 'typescript', 'json', 'css', 'html'],
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    // Expose monaco-editor depuis node_modules sous /monaco-editor
    publicDir: 'public',
    server: {
      // Le serveur Express intègre Vite en middleware via `npm run dev`.
      // Une cible proxy ici pointerait vers ce même port lorsqu'un `vite dev`
      // est lancé par erreur, créant une boucle TCP infinie (ENOBUFS).
      // Le mode middleware force déjà `proxy: {}` ; on conserve la même règle
      // en mode Vite autonome pour échouer proprement au lieu de boucler.
      host: '127.0.0.1',
      port: configuredPort || 4000,
      strictPort: true,
      hmr: process.env.DISABLE_HMR === 'true' ? false : true,
      watch: process.env.DISABLE_HMR === 'true' ? null : {
        ignored: [
          '**/.Leanna-profile.json',
          '**/.Leanna/sandbox/**',
          '**/.project-memory.json',
          '**/.project-knowledge.json',
        ],
      },
      proxy: {},
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],
            'vendor-monaco': ['monaco-editor', '@monaco-editor/react'],
            'vendor-ui': ['lucide-react', 'motion', 'clsx', 'cva'],
            'vendor-ai': ['@google/genai', '@supabase/supabase-js'],
            'ide-core': [
              './src/components/UnifiedSidebar',
              './src/components/ide/FileExplorer',
              './src/components/ide/EditorTabs',
              './src/hooks/useFileSystem',
              './src/services/ideApi',
            ],
            'panels': [
              './src/components/panels/SandboxPanel',
              './src/components/panels/AgentPanel',
              './src/components/panels/VisionPanel',
              './src/views/DocumentsView',
            ],
          },
        },
      },
      // Monaco workers sont copiés par vite-plugin-monaco-editor
      // Désactiver le warning de chunk size pour vendor-monaco (expected)
      chunkSizeWarningLimit: 1000,
    },
  };
});
