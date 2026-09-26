import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SELF_ROOT } from './selfRoot.js';

const tmpConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'Leanna-keys-test-'));
process.env.Leanna_CONFIG_PATH = tmpConfigDir;

// Import dynamique après avoir configuré Leanna_CONFIG_PATH
const {
  addGeminiKey,
  removeGeminiKey,
  toggleGeminiKey,
  updateGeminiKeyLabel,
  getGeminiKeys,
} = await import('./geminiKeyPool');

after(() => {
  try {
    fs.rmSync(tmpConfigDir, { recursive: true, force: true });
  } catch {
    // Ignore error
  }
});

test('geminiKeyPool: key management operations in isolated temp store', async () => {
  const initialKeys = getGeminiKeys();
  const testKey = `AIzaSyTestKey_${Date.now()}`;

  await addGeminiKey(testKey, 'Test Key Label');
  const keysAfterAdd = getGeminiKeys();
  assert.equal(keysAfterAdd.length, initialKeys.length + 1);

  const addedIndex = keysAfterAdd.findIndex(k => k.label === 'Test Key Label');
  assert.ok(addedIndex >= 0);
  assert.equal(keysAfterAdd[addedIndex].preview.startsWith('AIzaSy'), true);

  await updateGeminiKeyLabel(addedIndex, 'Updated Label');
  const keysAfterUpdate = getGeminiKeys();
  assert.equal(keysAfterUpdate[addedIndex].label, 'Updated Label');

  const disabledState = await toggleGeminiKey(addedIndex);
  assert.equal(disabledState, false); // false = not enabled (disabled)
  assert.equal(getGeminiKeys()[addedIndex].disabled, true);

  await toggleGeminiKey(addedIndex); // re-enable

  await removeGeminiKey(addedIndex);
  assert.equal(getGeminiKeys().length, initialKeys.length);
});

test('geminiKeyPool: rejects duplicate keys in isolated temp store', async () => {
  const key = `AIzaSyDuplicate_${Date.now()}`;
  await addGeminiKey(key, 'Dup Key');
  await assert.rejects(async () => {
    await addGeminiKey(key, 'Dup Key 2');
  }, /déjà/);

  const keys = getGeminiKeys();
  const idx = keys.findIndex(k => k.label === 'Dup Key');
  if (idx >= 0) await removeGeminiKey(idx);
});
