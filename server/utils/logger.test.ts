import test from 'node:test';
import assert from 'node:assert/strict';
import { logger, createLogger } from './logger.js';

test('logger: isLevelEnabled filtering', () => {
  logger.configure({ level: 'warn' });
  assert.equal(logger.isLevelEnabled('debug'), false);
  assert.equal(logger.isLevelEnabled('info'), false);
  assert.equal(logger.isLevelEnabled('warn'), true);
  assert.equal(logger.isLevelEnabled('error'), true);

  logger.configure({ level: 'debug' });
  assert.equal(logger.isLevelEnabled('debug'), true);
});

test('logger: createLogger and child logger naming', () => {
  const log = createLogger('TestModule');
  assert.ok(log);

  const childLog = log.child('SubModule');
  assert.ok(childLog);
});
