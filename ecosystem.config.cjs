module.exports = {
  apps: [
    // ── 1. Serveur backend Express/WS ──────────────────────────────────────
    {
      name: "leanna-server",
      script: "./dist/server.cjs",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      watch: false,
      autorestart: true,
      exp_backoff_restart_delay: 100,
      max_memory_restart: "1G",
      shutdown_with_message: true,
      kill_timeout: 3000,
      env: {
        NODE_ENV: "production",
      },
    },

    // ── 2. Interface Electron (fenêtre de bureau) ──────────────────────────
    // PM2 attend que le serveur soit prêt (géré dans start-electron-only.cjs),
    // puis ouvre la fenêtre Electron.
    //
    // Comportement :
    //   - Clic sur la croix  → fenêtre cachée dans le system tray (PM2 ne redémarre PAS)
    //   - "Quitter" du tray  → Electron se ferme proprement (PM2 redémarre si autorestart: true)
    //
    // Pour ne PAS redémarrer automatiquement Electron après un "Quitter",
    // mettez autorestart: false et lancez-le manuellement : pm2 start leanna-electron
    {
      name: "leanna-electron",
      script: "./scripts/start-electron-only.cjs",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      watch: false,
      autorestart: false,   // ← false : évite la boucle si l'utilisateur quitte volontairement
      kill_timeout: 5000,
      env: {
        NODE_ENV: "production",
        // Sur Linux headless, ajuster DISPLAY si nécessaire (ex: DISPLAY: ":1")
        DISPLAY: process.env.DISPLAY || ":0",
      },
    },
  ],
};
