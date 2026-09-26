import test from 'node:test';
import assert from 'node:assert/strict';
import {
  requestConfirmation,
  handleConfirmationResponse,
  getPendingCount,
  cancelAllPending,
} from './confirmationBridge.js';

test('confirmationBridge: handles approved confirmation response', async () => {
  cancelAllPending();
  let emittedData: any = null;
  const emitFn = (data: any) => {
    emittedData = data;
  };

  const confirmPromise = requestConfirmation('server/server.ts', 'modify', emitFn, 'test reason');
  assert.equal(getPendingCount(), 1);
  assert.ok(emittedData);
  assert.equal(emittedData.type, 'confirm-critical-edit');
  assert.equal(emittedData.filePath, 'server/server.ts');

  const handled = handleConfirmationResponse(emittedData.requestId, true);
  assert.equal(handled, true);

  const result = await confirmPromise;
  assert.equal(result, true);
  assert.equal(getPendingCount(), 0);
});

test('confirmationBridge: handles rejected confirmation response', async () => {
  cancelAllPending();
  let emittedData: any = null;
  const emitFn = (data: any) => {
    emittedData = data;
  };

  const confirmPromise = requestConfirmation('config.json', 'delete', emitFn);
  const handled = handleConfirmationResponse(emittedData.requestId, false);
  assert.equal(handled, true);

  const result = await confirmPromise;
  assert.equal(result, false);
  assert.equal(getPendingCount(), 0);
});

test('confirmationBridge: returns false for unknown requestId', () => {
  cancelAllPending();
  const handled = handleConfirmationResponse('unknown-id-123', true);
  assert.equal(handled, false);
});

test('confirmationBridge: cancelAllPending resolves all pending as false', async () => {
  cancelAllPending();
  let emittedCount = 0;
  const emitFn = () => { emittedCount++; };

  const p1 = requestConfirmation('a.ts', 'modify', emitFn);
  const p2 = requestConfirmation('b.ts', 'delete', emitFn);
  assert.equal(getPendingCount(), 2);

  cancelAllPending();
  assert.equal(getPendingCount(), 0);

  const [r1, r2] = await Promise.all([p1, p2]);
  assert.equal(r1, false);
  assert.equal(r2, false);
});
