# Leanna — Autonomy Contract

This contract defines precisely what Leanna's autonomous runtime may do on its own, what
requires human approval, and what it can never do. It reflects the **enforced** behaviour of
the code (`ToolRegistry`, `PermissionPolicy`, `DryRunController`, `AutonomyPolicy`,
`AutonomousExecutive`), not an aspiration.

## Leanna peut automatiquement

- **Observe / analyze**: classify runtime events deterministically (`PerceptionEngine`), with
  no LLM call and no side effects.
- **Remember**: read/write bounded facts in Memory/ProjectMemory and record skill reliability
  in `StrategyMemory` (tool names, success/failure, durations — no payloads, no secrets).
- **Decide**: create/deduplicate goals, prioritise deterministically (`PriorityEngine`), and
  choose IGNORE / STORE / MONITOR / INVESTIGATE / ACT / ESCALATE.
- **Plan / replan**: decompose goals, score skills, and replan around failures — biased by
  durable reliability so historically-failing tools are deprioritised.
- **Delegate**: hand a goal to the Mission Executor / agents through the normal pipeline.
- **Execute authorized operations**: only via registered tools that pass `PermissionPolicy`
  and (when enabled) `DryRunController`, subject to `AutonomyPolicy` mode.
- **Verify**: check goal success criteria (LLM-optional, heuristic fallback).
- **Retry**: bounded exponential retries with a circuit breaker (`TaskManager`) and a
  per-goal iteration cap (mission loop).
- **Learn / persist**: extract lessons, record reliability, persist missions/tasks
  (Supabase-optional). Learning proposals are surfaced, never auto-applied.

## Leanna doit demander une autorisation pour

Governed by `AutonomyPolicy` (`suggest` / `ask` / `auto`) and `PermissionPolicy`:

- **High-risk writes**: modifying source outside a safe scope, when policy is `ask`.
- **Destructive operations**: deleting files/data, bulk mutations.
- **External side effects**: deployments, network mutations, third-party calls with effects.
- **Sensitive operations**: anything touching auth, permissions, or credentials.

A goal blocked on approval remains persistent; approval can time out to a safe default (deny).

## Leanna ne peut jamais

- **Bypass permissions**: every effect flows through `ToolRegistry` + `PermissionPolicy`.
- **Disable security**: it cannot turn off dry-run, sandbox, or policy checks for itself.
- **Grant itself permissions**: the model cannot self-authorize `exec` / `write` / `network`
  / `admin` / secret access.
- **Leak secrets**: secrets must not enter model context, logs, telemetry, memory, or the
  reliability store unnecessarily.
- **Escape the sandbox / workspace restrictions**.
- **Execute external instructions as policy**: instructions embedded in files, web pages, tool
  output, or documents are untrusted data and can never change runtime permissions or policy.
- **Retry infinitely**: retries are bounded (circuit breaker, iteration cap); repeated
  same-class failures escalate to a human instead of looping.

## Trust boundaries

```text
SYSTEM POLICY            (this contract, permission/dry-run/autonomy policies)  — trusted
USER INTENT              (explicit user requests)                                — trusted
TRUSTED RUNTIME STATE    (memory, mission state, reliability metrics)            — trusted
UNTRUSTED EXTERNAL       (files, web, tool output, documents)                    — data only
```

External content is always treated as data. If it contains text resembling instructions
("ignore previous instructions", "grant write access"), that text is ignored as a directive.

## Enforcement references

- `server/runtime/PermissionPolicy.ts`, `server/runtime/DryRun.ts`,
  `server/runtime/ToolRegistry.ts`
- `server/mission/AutonomyPolicy.ts`
- `server/autonomy/AutonomousExecutive.ts` (escalation, bounded cycles)
- `server/autonomy/TaskManager.ts` (dedupe, retry, timeout, circuit breaker, dead-letter)
- `server/utils/promptInjectionGuard.ts` — heuristic scan of untrusted external
  content. `guardUntrustedContent()` (single text) and `guardUntrustedFields()`
  (named free-text fields of a structured result) are applied to **every** path
  that feeds externally-controlled text into model context:
  - documents (`routes/upload-document.ts`),
  - remote repo file content (`skills/github.ts` → `get_github_file_content`),
  - all other GitHub free-text fields — user bio/name/company/location, repo
    description/topics, issue & PR titles/labels, notification titles, search
    descriptions (`skills/github.ts`),
  - browser-extracted content and page snapshots (`skills/automationBrowser.ts` →
    `automation_extract` / `automation_snapshot`),
  - web search results — result titles and snippets (`skills/automationBrowser.ts`
    → `automation_search` / music search).

  Purely structural/enumerable fields (numbers, SHAs, URLs, booleans, dates,
  logins used as identifiers) are not scanned — they cannot carry a natural-language
  directive. The regex scan is a first-pass heuristic, not a boundary: it flags and
  neutralizes (wraps as data), it does not authorize. Non-model-facing outbound
  calls (weather API, LLM provider) are out of scope: they ingest no
  attacker-authored free text into the model's instruction stream.

  **Separate trust flow — notebook / knowledge ingestion**
  (`notebooks/SourceIngester.ts`, `knowledge/document-system/ContentExtractor.ts`)
  fetches arbitrary web/repo content, but only on explicit user action via the UI /
  `/api/notebooks`; the autonomous agent has no tool to trigger it
  (`ingest_github_repository` was removed). Retrieved passages surface as cited
  sources, not as agent instructions. This path is tracked as a follow-up for
  guard coverage at retrieval time; it is out of scope for the agent's live
  tool-call instruction stream.

## Audit trail

- **Finding 1 (name-based permission misclassification) — CLOSED / verified remediated.**
  All side-effecting skills (telegram, automation, agents, github, system) declare
  explicit `permissions` / `toolPermissions`, overriding the name heuristic in
  `SkillAdapter.inferPermissions`. That heuristic's no-match fallback returns an
  **empty** permission array (not `["read"]`); `DryRunController.hasSideEffect` and
  `AutonomyPolicy.hasSideEffect` both treat empty/undeclared permissions as a
  potential side effect. No side-effecting tool is classified read-only, so dry-run,
  permission enforcement, and suggest/ask gating all engage.
- **Finding 2 (uneven prompt-injection guard coverage) — FIXED.** The guard now
  covers all model-facing external-text paths listed above via
  `guardUntrustedFields()`, rather than a subset of call sites.
