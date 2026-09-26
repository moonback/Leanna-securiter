// Test d'une connexion WebSocket /terminal pour reproduire l'erreur 1006
const WebSocket = require('ws');
const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.join(__dirname, '.env.local') });
dotenv.config({ path: path.join(__dirname, '.env') });
const port = process.env.VITE_SERVER_PORT || 4000;
const ws = new WebSocket(`ws://127.0.0.1:${port}/terminal`);
let opened = false;

ws.on('open', () => {
  opened = true;
  console.log('[WS TEST] OPEN — connexion établie');
  ws.send(JSON.stringify({ type: 'resize', cols: 80, rows: 24 }));
  ws.send(JSON.stringify({ type: 'input', data: 'echo WS_PTY_OK\r\n' }));
});
ws.on('message', (data) => {
  const s = data.toString();
  console.log('[WS TEST] MESSAGE:', JSON.stringify(s.slice(0, 80)));
});
ws.on('error', (err) => {
  console.error('[WS TEST] ERROR:', err.message);
});
ws.on('close', (code, reason) => {
  console.log('[WS TEST] CLOSE code:', code, 'reason:', reason.toString(), 'wasOpened:', opened);
  process.exit(0);
});
setTimeout(() => { try { ws.close(); } catch {} process.exit(0); }, 4000);
