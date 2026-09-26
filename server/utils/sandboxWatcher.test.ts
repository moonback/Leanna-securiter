import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { WebSocket } from 'ws';
import { addWatchClient, startWatching, stopWatching, getWatchClientCount } from './sandboxWatcher.js';

// Mock simple WebSocket client
class MockWebSocket extends EventEmitter {
  readyState = WebSocket.OPEN;
  sentMessages: string[] = [];

  send(data: string) {
    this.sentMessages.push(data);
  }

  close() {
    this.emit('close');
  }

  error() {
    this.emit('error');
  }
}

test('sandboxWatcher: addWatchClient and count', () => {
  const ws1 = new MockWebSocket() as unknown as WebSocket;
  const ws2 = new MockWebSocket() as unknown as WebSocket;

  addWatchClient(ws1);
  assert.equal(getWatchClientCount(), 1);

  addWatchClient(ws2);
  assert.equal(getWatchClientCount(), 2);

  // Trigger close on ws1
  (ws1 as unknown as MockWebSocket).close();
  assert.equal(getWatchClientCount(), 1);

  // Trigger error on ws2
  (ws2 as unknown as MockWebSocket).error();
  assert.equal(getWatchClientCount(), 0);
});

test('sandboxWatcher: start and stop watching lifecycle', () => {
  // Test starting/stopping does not crash
  assert.doesNotThrow(() => {
    startWatching();
    stopWatching();
  });
});
