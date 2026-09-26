import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendAuditEvent, readAuditEntries, analyzeAuditLog } from './audit.js';

test('appendAuditEvent writes and reads audit entries', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'Leanna-audit-'));
  const logPath = path.join(tempDir, 'audit.log');

  await appendAuditEvent({ action: 'write_file', target: 'src/App.tsx', details: 'saved', logPath });
  await appendAuditEvent({ action: 'delete_file', target: 'src/Old.tsx', details: 'removed', logPath });

  const entries = await readAuditEntries(logPath, 10);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].action, 'write_file');
  assert.equal(entries[1].target, 'src/Old.tsx');
});

test('analyzeAuditLog calculates correctly', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'Leanna-audit-'));
  const logPath = path.join(tempDir, 'audit_analyze.log');

  await appendAuditEvent({ action: 'write_file', target: 'src/App.tsx', logPath });
  await appendAuditEvent({ action: 'write_file', target: 'src/App.tsx', logPath });
  await appendAuditEvent({ action: 'delete_file', target: 'src/Old.tsx', logPath });

  const analysis = await analyzeAuditLog(logPath);

  assert.equal(analysis['write_file on src/App.tsx'], 2);
  assert.equal(analysis['delete_file on src/Old.tsx'], 1);
});
