import test from 'node:test';
import assert from 'node:assert/strict';
import {
  requiresRestart,
  subscribeToRestart,
  triggerRestartIfNeeded,
  getRestartStatus
} from './serverRestart.js';

test('serverRestart: requiresRestart logic', () => {
  // Server critical files/folders should return true
  assert.equal(requiresRestart('server.ts'), true);
  assert.equal(requiresRestart('server/utils/selfRoot.ts'), true);
  assert.equal(requiresRestart('electron/main.cjs'), true);

  // Non-server files should return false
  assert.equal(requiresRestart('src/App.tsx'), false);
  assert.equal(requiresRestart('assets/image.png'), false);
  assert.equal(requiresRestart('package.json'), false);
});

test('serverRestart: subscribe and notifications', () => {
  let receivedPayload: any = null;
  const unsubscribe = subscribeToRestart((payload) => {
    receivedPayload = payload;
  });

  // Triggering restart on dynamic/non-real file should notify subscribers if it matches restart logic
  const triggered = triggerRestartIfNeeded('server/utils/dummy.ts');
  assert.equal(triggered, true);

  // Check state after trigger
  const status = getRestartStatus();
  assert.equal(status.pending, true);

  // Subscriber should have received a notification
  assert.ok(receivedPayload);
  assert.equal(receivedPayload.type, 'server-restart');
  assert.equal(receivedPayload.filePath, 'server/utils/dummy.ts');
  assert.equal(receivedPayload.status, 'pending');

  unsubscribe();
});
