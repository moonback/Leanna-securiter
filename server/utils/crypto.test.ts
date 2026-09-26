import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import os from 'node:os';
import { encrypt, decrypt } from './crypto.js';

test('crypto: GCM encrypt and decrypt returns original text', () => {
  const plainText = 'sk-or-v1-abcdef1234567890';
  const encrypted = encrypt(plainText);

  assert.notEqual(encrypted, plainText);
  assert.match(encrypted, /^gcm:[0-9a-fA-F]{24}:[0-9a-fA-F]{32}:[0-9a-fA-F]+$/);

  const decrypted = decrypt(encrypted);
  assert.equal(decrypted, plainText);
});

test('crypto: decrypt supports legacy AES-256-CBC format for backwards compatibility', () => {
  const plainText = 'legacy-secret-api-key-12345';

  // Create a legacy CBC encrypted string using the same master key derivation
  const envKey = process.env.Leanna_MASTER_KEY || '';
  let userInfo = '';
  try { userInfo = os.userInfo().username; } catch { userInfo = 'default-user'; }
  const rawSecret = envKey + `${os.hostname()}-${os.platform()}-${userInfo}`;
  const key = crypto.createHash('sha256').update(rawSecret).digest();

  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const legacyEncryptedString = iv.toString('hex') + ':' + encrypted;

  const decrypted = decrypt(legacyEncryptedString);
  assert.equal(decrypted, plainText);
});

test('crypto: decrypt falls back to original text on non-encrypted string', () => {
  const plainText = 'plain-text-secret';
  const decrypted = decrypt(plainText);
  assert.equal(decrypted, plainText);
});

test('crypto: decrypt falls back to original text on invalid encrypted format', () => {
  const invalidFormat = 'nothexbut32charslongstringhere12:abc';
  const decrypted = decrypt(invalidFormat);
  assert.equal(decrypted, invalidFormat);
});

test('crypto: decrypt falls back to original text on tampered GCM ciphertext', () => {
  const plainText = 'super-secret';
  const encrypted = encrypt(plainText);
  // Tamper with the ciphertext
  const tampered = encrypted.slice(0, -4) + '0000';
  const decrypted = decrypt(tampered);
  assert.equal(decrypted, tampered);
});
