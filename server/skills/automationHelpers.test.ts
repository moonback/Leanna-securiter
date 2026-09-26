import test from 'node:test';
import assert from 'node:assert/strict';
import { assertSafeUrl, parseIntervalToMs } from './automationHelpers.js';

test('automationHelpers: assertSafeUrl', async () => {
  // Safe URLs (public domains that should resolve to public IPs)
  const safeRes1 = await assertSafeUrl('http://example.com');
  assert.equal(safeRes1.ok, true);
  if (safeRes1.ok) {
    assert.equal(safeRes1.url, 'http://example.com/');
  }

  const safeRes2 = await assertSafeUrl('https://google.com/search?q=test');
  assert.equal(safeRes2.ok, true);
  if (safeRes2.ok) {
    assert.equal(safeRes2.url, 'https://google.com/search?q=test');
  }

  // Unsafe schemas
  const ftpRes = await assertSafeUrl('ftp://example.com');
  assert.equal(ftpRes.ok, false);
  if (!ftpRes.ok) {
    assert.match(ftpRes.error, /Schéma d'URL non autorisé/);
  }

  // Blocked hosts (IP literals)
  const blockRes1 = await assertSafeUrl('http://169.254.169.254');
  assert.equal(blockRes1.ok, false);
  if (!blockRes1.ok) {
    assert.match(blockRes1.error, /Hôte non autorisé|privée/i);
  }

  const blockRes2 = await assertSafeUrl('https://metadata.google.internal/some/path');
  assert.equal(blockRes2.ok, false);
  if (!blockRes2.ok) {
    assert.match(blockRes2.error, /Hôte non autorisé/);
  }

  // Private IP literals should be blocked
  const privateRes1 = await assertSafeUrl('http://127.0.0.1');
  assert.equal(privateRes1.ok, false);
  if (!privateRes1.ok) {
    assert.match(privateRes1.error, /privée|locale/i);
  }

  const privateRes2 = await assertSafeUrl('http://192.168.1.1');
  assert.equal(privateRes2.ok, false);
  if (!privateRes2.ok) {
    assert.match(privateRes2.error, /privée|locale/i);
  }

  // Invalid URLs
  const invalidRes = await assertSafeUrl('not-a-url');
  assert.equal(invalidRes.ok, false);
  if (!invalidRes.ok) {
    assert.match(invalidRes.error, /URL invalide/);
  }
});

test('automationHelpers: parseIntervalToMs', () => {
  // Explicit numerical inputs
  assert.equal(parseIntervalToMs({ intervalSeconds: 45 }), 45 * 1000);
  assert.equal(parseIntervalToMs({ intervalMinutes: 10 }), 10 * 60 * 1000);
  assert.equal(parseIntervalToMs({ intervalHours: 3 }), 3 * 3600 * 1000);

  // String expression inputs
  assert.equal(parseIntervalToMs({ interval: '30s' }), 30 * 1000);
  assert.equal(parseIntervalToMs({ interval: '5m' }), 5 * 60 * 1000);
  assert.equal(parseIntervalToMs({ interval: '12h' }), 12 * 3600 * 1000);
  assert.equal(parseIntervalToMs({ interval: '10 mins' }), 10 * 60 * 1000);
  assert.equal(parseIntervalToMs({ interval: '2 hours' }), 2 * 3600 * 1000);

  // Fallbacks / invalid inputs
  assert.equal(parseIntervalToMs({}), null);
  assert.equal(parseIntervalToMs({ interval: 'invalid-expression' }), null);
  assert.equal(parseIntervalToMs({ intervalSeconds: -5 }), null);
});
