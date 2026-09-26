# Leanna — Autonomy Implementation Report

Date: 2026-09-23. Companion to [`LEANNA_AUTONOMY_MASTER_AUDIT.md`](LEANNA_AUTONOMY_MASTER_AUDIT.md).
This report describes what actually changed, why, and how it was verified. It follows the
directive "close loops, don't rewrite": the largest, correctly-scoped gap was the
**cross-mission learning loop**, which is now closed with a small durable metrics layer that
reuses existing systems.

## 1. Résumé

Leanna's **intra-mission** cognitive loop (perceive → decide → plan → execute → verify →
reflect) was already real and tested. The missing piece was **experience reuse across
missions**: lessons and skill outcomes were produced but never read back into planning, so
"learning" changed nothing. This work closes that loop with a durable skill-reliability
memory (`StrategyMemory`) that biases planning, replanning, and autonomous decisions, plus a
real type-bug fix and an observability endpoint. No existing subsystem was rewritten or
duplicated.

## 2. Architecture avant

- Perception → Decision → Mission bridge: wired (`server.ts` → `Executor.startMission` /
  `waitForMission`), blocking on terminal state.
- Mission loop: wave scheduler with dependency ordering, replan/retry/escalate, pause/resume,
  budget guard via `telemetryService`.
- Reflection wrote lessons to `ProjectMemory`; `finalizeMission` called
  `LearningEngine.learnFromMission({applyAutoImprovements:false})`.
- **Gap**: `mission/Planner` and `mission/SkillScorer` never read those lessons.
  `SkillScorer.usageHistory` was in-memory, reset every process. `AutonomousExecutive.decide`
  used only perception importance. A stale type error blocked one path in `LeannaCore`.

## 3. Architecture après

```text
mission N executes → SkillScorer.recordUsage + StrategyMemory.recordSkillOutcome (durable JSON)
                                                        │
mission N+1 startMission → SkillScorer.seedFromReliability(StrategyMemory.getAllStats())
                                                        │
        Planner.decompose prompt ← failing-skill warnings (StrategyMemory.getFailingSkills)
        Planner.replan ← excludes durably-failing skills (keeps ≥1 tool)
                                                        │
AutonomousExecutive.decide ← recallOutcome(fingerprint) → urgency bonus + escalate-after-3-failures
autonomy cycle end → persist per-fingerprint failure tally (project memory)
                                                        │
GET /api/v2/metrics/reliability ← StrategyMemory (observable)
```

The learning loop is now **closed**: a skill that fails in one mission is scored lower in the
next, before any in-process failure is re-observed.

## 4. Fichiers créés

- `server/knowledge/StrategyMemory.ts` — durable, per-workspace skill-reliability store
  (atomic tmp+rename persistence, decay/prune, `ephemeral` mode for tests, singleton
  `strategyMemory`). A compact **metrics** store, not a new cognitive memory.
- `server/knowledge/StrategyMemory.test.ts` — 6 tests.
- `server/mission/Planner.replan.test.ts` — 2 tests (learning-informed replanning).
- `docs/LEANNA_AUTONOMY_MASTER_AUDIT.md`, `docs/LEANNA_AUTONOMY_IMPLEMENTATION_REPORT.md`,
  `docs/AUTONOMY_CONTRACT.md`.

## 5. Fichiers modifiés

- `server/autonomy/AutonomousExecutive.ts` — index signature on `AutonomousExecutiveEvent`
  (GAP-4 fix); `recallOutcome` + `fingerprint` (memory-informed decisions); per-fingerprint
  failure tally in `execute`.
- `server/autonomy/AutonomousExecutive.test.ts` — 3 tests for memory-informed decisions.
- `server/mission/SkillScorer.ts` — `seedFromReliability(stats)`.
- `server/mission/Executor.ts` — seed scorer at `startMission`; record outcome in
  `executeAction`.
- `server/mission/Planner.ts` — failing-skill warning in decompose prompt;
  `durableFailingSkillNames` used by `replan`.
- `server/runtime/routes/metrics.ts` — `GET /api/v2/metrics/reliability`.
- `.gitignore` — ignore `.Leanna-strategy.json(.tmp)` runtime artifacts.

## 6. Fichiers supprimés

- `.Leanna-strategy.json`, `.Leanna-strategy.json.tmp` — runtime artifacts that had been
  accidentally tracked; removed from git and now ignored.

## 7. Fonctions ajoutées

`StrategyMemory.recordSkillOutcome / getSkillStats / getAllStats / getFailingSkills /
save / reset`; `SkillScorer.seedFromReliability`; `Planner.buildFailingSkillsWarning /
durableFailingSkillNames`; `AutonomousExecutive.recallOutcome / fingerprint`.

## 8. Bugs corrigés

- **GAP-4**: `tsc` error at `LeannaCore.ts:122` (broadcastExecutive index-signature
  mismatch). Total `tsc --noEmit` errors 372 → 371.

## 9. Boucles autonomes fermées

- **Cross-mission learning → planning** (GAP-1): durable skill reliability now seeds the
  scorer and warns the planner. **Closed + tested.**
- **Learning → dynamic replanning**: `replan` drops durably-failing tools. **Closed + tested.**
- **Failure memory → decision** (GAP-2): repeated same-class failures escalate instead of
  re-attempting an impossible goal. **Closed + tested.**

## 10. Mémoire

Reused: Hierarchical Memory, ProjectMemory (prose lessons), KnowledgeGraph. Added a compact
numeric reliability store (StrategyMemory) because ProjectMemory rejects short/duplicate
facts and is unsuitable for high-frequency counters. No fourth cognitive memory was created.

## 11. Learning

`LearningEngine.learnFromMission` remains `applyAutoImprovements:false` (no autonomous
workspace/policy mutation). New: skill outcomes are persisted and **consumed** by planning.

## 12. Planning

Planner now receives failing-skill warnings and, on replan, excludes durably-failing tools
while guaranteeing at least one option remains (never makes replanning impossible).

## 13. DAG

Unchanged by design. Mission wave scheduler (dependency waves, parallel, fan-in) owns
autonomy missions; `BrainScheduler` owns interactive multi-agent orchestration via routes.
Documented as intentional separation (GAP-3) — merging would regress two tested systems.

## 14. Self-healing

Existing `BrainCorrectionLoop` / `AgentRepairLoop` / `ReflectionEngine` / replan retained.
New guard: same-class failures escalate after a bounded count, preventing infinite retries.

## 15. Security

Untouched and not weakened. All execution still flows through `ToolRegistry` +
`PermissionPolicy` + `DryRunController` + `AutonomyPolicy`. StrategyMemory records only skill
names/outcome booleans/durations — no secrets, no payloads. See `docs/AUTONOMY_CONTRACT.md`.

## 16. Persistence

Reused `MissionStore` and `AutonomyPersistence` (Supabase-optional). StrategyMemory persists
to a per-workspace JSON file with atomic writes, degrading to in-memory on any I/O error.

## 17. Recovery

Reused `Executor.resumePending` and `LeannaCore.resumePersistedTasks`. Interrupted work is
never treated as success. StrategyMemory reloads on workspace change.

## 18. API

Added `GET /api/v2/metrics/reliability` (auth-guarded like other metrics) exposing the
reliability signal that biases planning, so decisions are explainable.

## 19. WebSockets

Unchanged. The `/autonomy` timeline channel already broadcasts autonomy events.

## 20. UI

Unchanged in this increment. The reliability endpoint provides the data a cockpit panel can
consume; no parallel UI was introduced.

## 21. Tests

New/extended: `StrategyMemory.test.ts` (6), `Planner.replan.test.ts` (2),
`AutonomousExecutive.test.ts` (+3). Verified green together with `LeannaCore.test.ts` and
`PerceptionEngine.test.ts`: **23 passing, 0 failing**.

## 22. Performance

StrategyMemory is O(1) per record and bounded (≤400 skills, ≤20 recent samples each). Seeding
is O(skills) once per mission. No new LLM calls, no blocking I/O in the hot path (persistence
is best-effort and small).

## 23. Security audit

- No new permission surface; no secret handling changed.
- External content cannot alter permissions (StrategyMemory only stores tool names/outcomes).
- The reliability endpoint returns aggregate stats only.

## 24. Remaining limitations

- `tsc --noEmit` still reports 371 pre-existing errors (mostly `TS7030` in `server/routes/*`
  and `noUnusedLocals` in tests). These predate this work; the repo builds via esbuild and
  gates on the custom lint (0 errors). Reducing the tsc debt is a separate, large task.
- `Executor.test.ts` runs real LLM/timer paths and does not terminate quickly without provider
  keys; this is pre-existing and unrelated to these changes.
- Mission planning still does not read ProjectMemory *prose* lessons directly (only the
  numeric reliability signal). Prose-lesson injection into decomposition is a future step.
- Brain DAG and mission scheduler remain two systems (intentional).

## 25. External dependencies

None added. No new npm packages.

## 26. Configuration/environment changes

None required. StrategyMemory works with zero configuration and degrades gracefully. Writes
`.Leanna-strategy.json` in the active workspace root (now gitignored).

## 27. Database migrations

None. StrategyMemory is file-based per workspace (consistent with ProjectMemory). If durable
cross-instance reliability is later desired, it can adopt the existing `AutonomyPersistence`
Supabase pattern.

## 28. Commands used

```powershell
npx tsc --noEmit                                  # error count baseline/after
node scripts/lint.cjs [paths]                     # style gate (0 errors required)
node --import tsx --test --test-timeout=30000 <file>   # per-file tests
```

## 29. Validation results

- **Lint**: 0 errors (pass) across the repo (warnings/info are pre-existing, non-failing).
- **tsc --noEmit**: 371 errors (was 372; −1 from GAP-4; **zero new** errors introduced).
- **Tests**: 23 passing / 0 failing across StrategyMemory, Planner.replan, AutonomousExecutive,
  LeannaCore, PerceptionEngine.

## 30. Matrice finale (Before / After / Evidence)

| Capability | Before | After | Evidence |
|---|---|---|---|
| Perception | Deterministic classification | Unchanged | `PerceptionEngine.ts` + test |
| Goal management | Dedupe + lifecycle | Unchanged | `AutonomousExecutive.GoalManager` + test |
| Decision | Perception-only | **Memory-informed** (escalate on repeated failure) | `recallOutcome` + 3 tests |
| Planning | LLM+heuristic, no history | **Reliability-biased** + failing-skill warnings | `Planner.buildFailingSkillsWarning`, `SkillScorer.seedFromReliability` |
| DAG | Mission waves + Brain DAG (separate) | Unchanged (documented) | `executeGoalsScheduled`, `BrainScheduler` |
| Parallelism | Dependency waves | Unchanged | `executeGoalsScheduled` |
| Execution | ToolRegistry-gated | Unchanged + outcome recording | `executeAction` + `recordSkillOutcome` |
| Verification | Criteria (LLM-opt) | Unchanged | `verifyGoalCriteria` |
| Reflection | Lessons → ProjectMemory | Unchanged | `Reflection.persistLessonsToMemory` |
| Self-healing | Correction/repair loops | + escalate-after-N-failures | `AgentRepairLoop`, `recallOutcome` |
| Memory | Hierarchical/Project/KG | + durable skill reliability | `StrategyMemory.ts` + test |
| Learning | Produced, unused by planning | **Consumed by planning/replan** | `seedFromReliability`, `Planner.replan` |
| Strategy reuse | None | Durable, cross-mission | `StrategyMemory.getAllStats/getFailingSkills` |
| Multi-agent | Orchestrator/Executor/Registry | Unchanged | `server/agents/*` |
| Delegation | Via mission/agents | Unchanged | `DelegationManager` |
| Persistence | Mission/task (Supabase-opt) | + reliability JSON | `MissionStore`, `AutonomyPersistence`, `StrategyMemory` |
| Recovery | resume pending/tasks | Unchanged | `resumePending`, `resumePersistedTasks` |
| Governance | Permission/DryRun/Autonomy policy | Unchanged | `PermissionPolicy`, `AutonomyPolicy` |
| Security | ToolRegistry-gated | Unchanged, not weakened | `docs/AUTONOMY_CONTRACT.md` |
| Observability | Metrics + WS timeline | + `/metrics/reliability` | `server/runtime/routes/metrics.ts` |
| Testing | Broad suite | +11 targeted tests | 23 passing / 0 failing |
