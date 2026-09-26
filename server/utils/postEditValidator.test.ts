import test from 'node:test';
import assert from 'node:assert/strict';
import {
  subscribeToValidation,
  getLastValidationResult,
  scheduleValidation,
} from './postEditValidator.js';

test('postEditValidator: subscribe and unsubscribe', () => {
  let called = false;
  const unsubscribe = subscribeToValidation(() => {
    called = true;
  });

  assert.equal(typeof unsubscribe, 'function');
  unsubscribe();
});

test('postEditValidator: scheduleValidation does not throw when disabled', () => {
  assert.doesNotThrow(() => {
    scheduleValidation(false);
  });
});

test('postEditValidator: getLastValidationResult returns null or previous result', () => {
  const result = getLastValidationResult();
  assert.ok(result === null || typeof result.valid === 'boolean');
});
