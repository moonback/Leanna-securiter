import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ContinuousAuditManager,
  EndpointWatcher,
  createContinuousAudit,
  type AuditRunner,
} from './ContinuousAuditManager.js';
import type { AuditOptions } from '../capability/SecurityCapability.js';
import type { ScanExecutionResult } from '../orchestrator/SecurityOrchestrator.js';

function fakeResult(): ScanExecutionResult {
  return {
    scanId: 'scan-test',
    targetPath: '.',
    profile: 'standard',
    triggerType: 'api',
    status: 'completed',
    startTime: '',
    durationMs: 1,
    filesScanned: 0,
    filesSkipped: 0,
    findingsCount: { total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 },
    findings: [],
    sbomComponents: [],
    scaOnlineEnrichment: false,
    cacheSize: 0,
    report: null,
  };
}

/** Runner espion qui enregistre les options d'audit reçues. */
function makeRunner() {
  const calls: AuditOptions[] = [];
  const runner: AuditRunner = {
    async audit(options: AuditOptions = {}) {
      calls.push(options);
      return fakeResult();
    },
  };
  return { runner, calls };
}

/** Scheduler manuel : capture le dernier callback, ne l'exécute pas seul. */
function manualScheduler() {
  let pending: (() => void) | null = null;
  const scheduler = (cb: () => void) => {
    pending = cb;
    return 1 as unknown as ReturnType<typeof setTimeout>;
  };
  const clearScheduler = () => { pending = null; };
  const fire = () => { const p = pending; pending = null; p?.(); };
  const hasPending = () => pending !== null;
  return { scheduler, clearScheduler, fire, hasPending };
}

test('disabled manager ignores events', async () => {
  const { runner, calls } = makeRunner();
  const sched = manualScheduler();
  const m = new ContinuousAuditManager(runner, { scheduler: sched.scheduler, clearScheduler: sched.clearScheduler });
  m.notify({ type: 'file_change', files: ['a.ts'] });
  assert.equal(sched.hasPending(), false);
  await m.flush();
  assert.equal(calls.length, 0);
});

test('debounces a burst into a single audit', async () => {
  const { runner, calls } = makeRunner();
  const sched = manualScheduler();
  const m = new ContinuousAuditManager(runner, { scheduler: sched.scheduler, clearScheduler: sched.clearScheduler });
  m.enable();

  m.notify({ type: 'file_change', files: ['a.ts'] });
  m.notify({ type: 'file_change', files: ['b.ts'] });
  m.notify({ type: 'file_change', files: ['a.ts'] }); // duplicate

  // Only one pending timer; fire it → single audit.
  sched.fire();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(calls.length, 1);
  assert.deepEqual([...(calls[0].changedFiles ?? [])].sort(), ['a.ts', 'b.ts']);
});

test('burst mode escalates to the strongest event mode', async () => {
  const { runner, calls } = makeRunner();
  const sched = manualScheduler();
  const m = new ContinuousAuditManager(runner, { scheduler: sched.scheduler, clearScheduler: sched.clearScheduler });
  m.enable();

  m.notify({ type: 'file_change' });       // quick
  m.notify({ type: 'commit' });            // standard → wins over quick
  const res = await m.flush();

  assert.ok(res);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].mode, 'standard');
});

test('flush with no pending event returns null and does not audit', async () => {
  const { runner, calls } = makeRunner();
  const m = new ContinuousAuditManager(runner, { debounceMs: 5 });
  m.enable();
  const res = await m.flush();
  assert.equal(res, null);
  assert.equal(calls.length, 0);
});

test('onResult callback fires with the triggering event', async () => {
  const { runner } = makeRunner();
  let seenType = '';
  const m = new ContinuousAuditManager(runner, {
    onResult: (_r, ev) => { seenType = ev.type; },
  });
  m.enable();
  m.notify({ type: 'dependency_change' });
  await m.flush();
  assert.equal(seenType, 'dependency_change');
});

test('EndpointWatcher detects added and removed routes', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cont-'));
  const routesDir = path.join(tmp, 'server', 'routes');
  fs.mkdirSync(routesDir, { recursive: true });
  const file = path.join(routesDir, 'r.ts');

  fs.writeFileSync(file, `router.get('/a', h);`);
  const watcher = new EndpointWatcher(routesDir);
  watcher.prime();

  // Add a route.
  fs.writeFileSync(file, `router.get('/a', h);\nrouter.post('/b', h);`);
  let d = watcher.diff();
  assert.equal(d.added.length, 1);
  assert.equal(d.added[0].route, '/b');
  assert.equal(d.removed.length, 0);

  // Remove a route.
  fs.writeFileSync(file, `router.post('/b', h);`);
  d = watcher.diff();
  assert.equal(d.removed.length, 1);
  assert.equal(d.removed[0].route, '/a');

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('createContinuousAudit wires a disabled manager + watcher', () => {
  const { runner } = makeRunner();
  const { manager, endpoints } = createContinuousAudit(path.resolve(process.cwd()), runner);
  assert.equal(manager.isEnabled(), false);
  assert.ok(endpoints instanceof EndpointWatcher);
});
