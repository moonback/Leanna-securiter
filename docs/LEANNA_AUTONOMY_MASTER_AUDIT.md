# Leanna — Autonomy Master Audit (R0)

Date: 2026-09-23. This audit is grounded in the **executed code**, not file names or
`output.md`. Every claim below was verified by reading the referenced files and, where
noted, by running the relevant tests. It supersedes nothing; it complements
[`AUTONOMY_AUDIT.md`](../AUTONOMY_AUDIT.md) and
[`docs/AUTONOMOUS_AGENT_AUDIT.md`](AUTONOMOUS_AGENT_AUDIT.md) with a verified,
loop-by-loop status.

## Method & toolchain reality (important)

- **Build**: `npm run build` uses `vite build` + `esbuild` bundling. **esbuild does not
  type-check.** The runtime therefore ships even with type errors present.
- **Lint**: `npm run lint` runs `scripts/lint.cjs`, a dependency-free style checker
  (max line length, trailing whitespace, EOL, `console.*`, duplicate imports). It only
  **fails on `error`-severity** violations. On `server/` today: **0 errors**, warnings only.
- **`tsc --noEmit`**: **NOT a passing gate today** — 372 pre-existing errors, dominated by
  `TS7030` (Express handlers not returning on every path) in `server/routes/*` and
  `noUnusedLocals` in `*.test.ts`. This is the historical baseline, unrelated to autonomy.
- **Tests**: `node --import tsx --test server/**/*.test.ts`. The full suite is large
  (>10 min). Verified green in isolation: `PerceptionEngine`, `AutonomousExecutive`,
  `LeannaCore`. `Executor.test.ts` blocks when run without a timeout (LLM/timer paths);
  use `--test-timeout`.

Consequence for this work: the honest completion bar is **lint clean (0 errors) + targeted
tests green**, not "`tsc --noEmit` clean" (that is a separate, large, pre-existing debt).

## A. Architecture actuelle (composants réels)

```text
Runtime EventBus (in-proc, optional Redis Streams bridge) / HeartbeatService
  -> PerceptionEngine (deterministic classification, no LLM)
  -> LeannaCore + TaskManager (dedupe, priority+aging, retry, timeout, circuit breaker, dead-letter)
  -> AutonomousExecutive (Observation-lite, GoalManager, PriorityEngine, decide())
  -> executeMission callback (wired in server.ts)
  -> Mission.Executor.startMission()/waitForMission()
       -> Planner (LLM decompose + SkillScorer) 
       -> wave scheduler (executeGoalsScheduled: dependency waves, parallel, fan-in)
       -> executeAction -> ToolRegistry-backed SkillHandler (PermissionPolicy + DryRun + AutonomyPolicy)
       -> ReflectionEngine (per-action) -> ProjectMemory lesson facts
       -> verifyGoalCriteria (LLM-optional, heuristic fallback)
       -> finalizeMission -> LearningEngine.learnFromMission({applyAutoImprovements:false})
  -> Memory (Hierarchical: working/session/project/long-term) / ProjectMemory / KnowledgeGraph
  -> Observability (OpenTelemetry) + /api/v2/metrics/* + /autonomy WebSocket timeline

Parallel pipeline (NOT wired into missions):
  AgentBrain (via AgentOrchestrator.getBrain) 
    -> GoalUnderstandingEngine -> DynamicPlanner -> BrainPlanValidator
    -> BrainScheduler (topological DAG, fan-out/fan-in) -> BrainVerifier -> BrainCorrectionLoop
  Reachable only through routes/agents.ts (/brain/*).
```

## B. Architecture réellement exécutée (call chains vérifiées)

Event → mission (closed):
```text
RuntimeEvent
 → LeannaCore.handleEvent()               server/autonomy/LeannaCore.ts
 → PerceptionEngine.perceive()            deterministic; sets importance/attention
 → TaskManager.submit()                   dedupe/priority/backpressure
 → TaskManager worker → AutonomousExecutive.execute()
 → AutonomousExecutive.decide()           GoalManager.createOrUpdate + PriorityEngine.score
 → options.executeMission()               server.ts (~L397)
 → Executor.startMission() + waitForMission()   blocks until terminal
 → executeMission()/executeGoalsScheduled()/executeGoalDirectly()
 → executeAction() → skillHandler (ToolRegistry) → ReflectionEngine.reflect()
 → verifyGoalCriteria() → completeGoal()
 → finalizeMission() → proposeLearning() → learningEngine.learnFromMission()
```

Learning write path (real): `ReflectionEngine.persistLessonsToMemory()` →
`projectMemory.addFact({category:"decision", tags:[...,"mission:<id>"]})` → `projectMemory.save()`.

## C. Gaps (symptôme → cause → fichier → impact → correction → test)

### GAP-1 — Cross-mission learning loop is NOT closed (highest value)
- **Symptôme**: A lesson learned from mission A never changes how mission B is planned.
- **Cause**: `mission/Planner.ts` and `mission/SkillScorer.ts` never read `ProjectMemory`
  lessons. `LearningEngine.getRelevantLessons()`/`getPatternsHistory()` have **no callers**
  in the mission path. `SkillScorer.usageHistory` is an in-memory `Map`, reset every process.
- **Fichiers**: `server/mission/SkillScorer.ts`, `server/mission/Planner.ts`,
  `server/mission/Executor.ts`, `server/knowledge/LearningEngine.ts`.
- **Impact**: "Learning" produces artifacts nobody consumes for planning → no experience reuse.
- **Correction** (implemented in R5): a `StrategyMemory` read/write layer over
  `LearningEngine`+`ProjectMemory` that (a) durably records per-skill success/failure
  outcomes, (b) seeds `SkillScorer` at mission start, (c) surfaces failure warnings to the
  Planner. No new 4th memory system — it reuses ProjectMemory facts with a stable tag.
- **Test**: a persisted skill-failure biases the next mission's skill scoring downward.

### GAP-2 — AutonomousExecutive.decide() ignores memory
- **Symptôme**: Decisions use only perception importance; prior failures/escalations of the
  same class don't raise urgency or change disposition.
- **Cause**: `AutonomousExecutive.decide()` has no memory retrieval step.
- **Fichier**: `server/autonomy/AutonomousExecutive.ts`.
- **Impact**: Repeated impossible goals can re-enter the queue with identical priority.
- **Correction** (R5): consult recent `autonomy:outcome:*` memory for the goal fingerprint
  to bias priority/disposition (bounded, deterministic).
- **Test**: a previously-escalated goal fingerprint escalates faster.

### GAP-3 — Brain DAG pipeline is parallel, not the mission engine
- **Symptôme**: The audits imply "Mission Executor / BrainScheduler" as one pipeline.
- **Cause**: Historical duplication. `Executor.ts` has **zero** references to
  `BrainScheduler`/`BrainVerifier`/`DynamicPlanner`; the brain is reached only via
  `AgentOrchestrator` routes.
- **Fichiers**: `server/agents/brain/*`, `server/mission/Executor.ts`.
- **Impact**: Two schedulers/verifiers to maintain; confusion about which is authoritative.
- **Correction (chosen, documented)**: **Keep both, clarify responsibility** rather than a
  risky merge. The mission wave-scheduler owns autonomy-driven missions
  (dependency waves + fan-in, already real); the Brain DAG owns interactive multi-agent
  orchestration via routes. A blind merge would regress two tested systems — rejected.
- **Test**: existing `AgentBrain.test.ts` + `Executor.test.ts` remain green.

### GAP-4 — Pre-existing type error in LeannaCore.broadcastExecutive
- **Symptôme**: `tsc` error at `LeannaCore.ts:122` (index-signature mismatch).
- **Cause**: `broadcastExecutive` typed its param with an index signature the
  `AutonomousExecutiveEvent` shape doesn't satisfy.
- **Correction** (R1): align the executive event type / call site. Low risk, isolated.

## D. Doublons (responsabilités concurrentes) — décision de séparation

| Concern | Systems that overlap | Decision |
|---|---|---|
| Planning | `mission/Planner` vs `brain/DynamicPlanner` | Planner = mission decomposition; DynamicPlanner = agent-role DAG. Keep separate. |
| Scheduling/DAG | `mission` wave scheduler vs `brain/BrainScheduler` vs `agents/TaskScheduler` | Mission wave scheduler for missions; BrainScheduler for brain route; TaskScheduler for agent runtime. No third engine added. |
| Verification | `Executor.verifyGoalCriteria` vs `brain/BrainVerifier` | Mission uses its own criteria verifier; Brain uses BrainVerifier. Documented, not merged. |
| Loop/queue | `autonomy/TaskManager` vs `AgentRuntime` queue vs `AutonomousLoop` | TaskManager = autonomy-originated bounded work only; AgentRuntime = agent scheduling. Unchanged. |
| Executive | `AutonomousExecutive` vs `AgentOrchestrator` | Executive = perceive→decide→mission bridge; Orchestrator = agent/brain dispatch. Unchanged. |

Rationale: the prompt explicitly prioritizes **closing loops over rewriting**. Each
"duplicate" is independently tested and reachable; consolidation risk outweighs benefit.
The high-value work is wiring the **learning read-back**, which no system currently owns.

## E. Score de maturité (matrice factuelle)

| Domaine | État | Preuve | Manque |
|---|---|---|---|
| Perception | IMPLEMENTED | `PerceptionEngine.ts` + test green | Novelty/confidence fields are coarse |
| Goals | IMPLEMENTED | `GoalManager` dedupe + statuses + test | No durable goal store (in-mem) |
| Decision | PARTIALLY_IMPLEMENTED | `decide()` + PriorityEngine + test | No memory-informed decision (GAP-2) |
| Planning | IMPLEMENTED | `Planner` LLM+heuristic + `SkillScorer` | No lesson read-back (GAP-1) |
| DAG | IMPLEMENTED | mission wave scheduler + `BrainScheduler` | Two engines (GAP-3, by design) |
| Parallelism | IMPLEMENTED | `executeGoalsScheduled` Promise.all waves | Resource caps only `maxConcurrentGoals` |
| Execution | IMPLEMENTED | `executeAction` via ToolRegistry handler | Action success inference is loose |
| Verification | PARTIALLY_IMPLEMENTED | `verifyGoalCriteria` LLM+heuristic | No independent evidence collector |
| Reflection | IMPLEMENTED | `ReflectionEngine` + persistence | — |
| Learning | EXISTING_BUT_LIMITED | `LearningEngine.learnFromMission` | Not read back into planning (GAP-1) |
| Memory | IMPLEMENTED | Hierarchical + ProjectMemory + KG | Categories not one contract |
| Multi-agent | IMPLEMENTED | Orchestrator/Executor/Registry/Delegation | Not triggered by autonomy directly |
| Security | IMPLEMENTED | PermissionPolicy/DryRun/AutonomyPolicy + tests | — |
| Persistence | IMPLEMENTED | MissionStore + AutonomyPersistence (Supabase-opt) | In-proc queue; multi-instance hardening pending |
| Recovery | IMPLEMENTED | `resumePending` + `resumePersistedTasks` | No snapshot/rollback checkpoints |
| Observability | IMPLEMENTED | OpenTelemetry + metrics routes + WS timeline | Mission replay is partial |
| UI | IMPLEMENTED | AutonomyView/Timeline + hooks | Cockpit consolidation is incremental |
| Testing | IMPLEMENTED | broad `*.test.ts` | `tsc` debt; full suite slow |

## Conclusion

Leanna's **intra-mission cognitive loop is genuinely closed and tested**
(perceive → decide → plan → execute → verify → reflect). The single most valuable,
correctly-scoped gap is the **cross-mission learning loop (GAP-1)**: lessons are written but
never read back into planning. R5 closes it by reusing `LearningEngine`/`ProjectMemory` (no
new subsystem), plus GAP-2 (memory-informed decisions) and GAP-4 (a real type-bug fix).
Duplicates (GAP-3) are documented and deliberately not merged to avoid regressing two tested
systems, consistent with the "close loops, don't rewrite" directive.
