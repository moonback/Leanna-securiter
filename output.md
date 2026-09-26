# Refonte de Leanna vers un OS spécialisé en Audit de Vulnérabilités

Ton dépôt contient déjà **énormément de briques directement réutilisables** pour un audit de sécurité (sandbox, AST, taint, graphe d'appels, agents, missions, politiques de permission, RAG). La refonte ne doit donc **pas être une réécriture**, mais un **recentrage** : retirer l'IDE généraliste du chemin critique, promouvoir les composants d'analyse en citoyens de premier ordre, et ajouter les couches propres au security (CWE/OWASP, SARIF, taint flow, scoring CVSS).

Voici la stratégie complète.

---

## 1. Diagnostic : ce qui existe et ce qu'il faut en faire

| Domaine actuel | Fichiers clés | Décision refonte |
|---|---|---|
| IDE Monaco / File explorer | `src/views/IdeView.tsx`, `components/ide/*` | **Dégrader en « viewer » secondaire** — utilisé uniquement pour visualiser les fichiers vulnérables |
| Sandbox / checkpoints | `server/utils/sandbox.ts`, `checkpoint.ts` | ✅ **Garder** — devient le mode « analyse offline sécurisée » |
| Knowledge Graph AST | `server/knowledge/ASTParser.ts`, `ASTCallGraph.ts` | ✅ **Promouvoir** — base du data-flow/taint analysis |
| Impact Analyzer | `server/knowledge/ImpactAnalyzer.ts` | 🔄 **Réorienter** — d'« impact fonctionnel » vers « impact sécurité » (blast radius d'une faille) |
| Agents (coder, reviewer…) | `server/agents/roles.ts` | ❌ **Retirer** coder/refactor/writer… ; ✅ **Renforcer** `security` + ajouter `sast`, `sca`, `secrets`, `iac`, `threat-modeler` |
| `securityAuditSkill` | `server/skills/securityAudit.ts` | 🔄 **Étendre massivement** — passer de skill unique à famille de scanners |
| Missions / Brain DAG | `server/mission/*`, `server/agents/brain/*` | ✅ **Garder** — parfait pour orchestrer un audit multi-étapes (recon → scan → triage → exploit-PoC → rapport) |
| Notebooks RAG | `server/notebooks/*` | 🔄 **Réorienter** — source de « knowledge base » CVE / CWE / threat intelligence |
| Marketplace | `server/marketplace/*` | 🔄 **Réorienter** — catalogue de « rules packs » (Semgrep/CodeQL-like) |
| Marketplace/Telegram/GitHub/PM2 | divers | ⚪ **Isoler en modules optionnels** (désactivés par défaut) |
| LeannaCore / Autonomy | `server/autonomy/*` | ✅ **Garder** — devient le « continuous security daemon » (SCA quotidien, re-scan sur commit) |

**Verdict** : ~60 % du backend est réutilisable tel quel. Le travail consiste à **élaguer le frontend généraliste**, **spécialiser les agents et skills**, et **ajouter 4 briques manquantes** : taint analysis, CVE/SCA, SARIF export, scoring CVSS/EPSS.

---

## 2. Nouvelle architecture cible

```
                    ┌─────────────────────────────────────────┐
                    │  Security Console (UI React)            │
                    │  - Findings Dashboard                   │
                    │  - Attack Surface Map (dérivé AST)      │
                    │  - Vulnerability Timeline               │
                    │  - Code Viewer (Monaco, lecture seule)  │
                    │  - Report Builder (SARIF/PDF/HTML)      │
                    └────────────────┬────────────────────────┘
                                     │ REST + WS /scan
                    ┌────────────────▼────────────────────────┐
                    │  Security Orchestrator (ex-LeannaCore)  │
                    │  - ScanScheduler (ex-HeartbeatService)  │
                    │  - FindingManager (ex-GoalManager)      │
                    │  - PolicyEngine (ex-AutonomyPolicy)     │
                    └────────────────┬────────────────────────┘
                                     │
        ┌────────────────────────────┼────────────────────────────┐
        │                            │                            │
┌───────▼────────┐         ┌─────────▼──────────┐       ┌─────────▼────────┐
│ STATIC (SAST)  │         │ SUPPLY CHAIN (SCA) │       │ RUNTIME (DAST)   │
│ AST + taint    │         │ CVE / EPSS / SBOM  │       │ fuzzer + Puppeteer│
│ CWE rules      │         │ license / typosquat│       │ API fuzzing      │
└────────────────┘         └────────────────────┘       └──────────────────┘
        │                            │                            │
        └────────────────────────────┼────────────────────────────┘
                                     │
                    ┌────────────────▼────────────────────────┐
                    │  Finding Engine                         │
                    │  - Normalize to SARIF 2.1.0             │
                    │  - Dedupe + fingerprinting              │
                    │  - Score (CVSS 3.1 + EPSS + KEV)        │
                    │  - Map to CWE / OWASP Top 10            │
                    └────────────────┬────────────────────────┘
                                     │
                    ┌────────────────▼────────────────────────┐
                    │  Knowledge Base (RAG)                   │
                    │  CVE / CWE / MITRE ATT&CK / CISA KEV    │
                    └─────────────────────────────────────────┘
```

---

## 3. Plan de refonte en 6 phases

### Phase 0 — Geler et taguer (1 j)

```bash
git checkout -b refonte/security-specialization
git tag v1.x-pre-security-refonte
```

Crée un fichier `SECURITY_SCOPE.md` qui **contractualise** la mission : SAST + SCA + secrets + IaC en priorité ; DAST en V2 ; pas d'exploitation active par défaut.

### Phase 1 — Élaguer le frontend (3–5 j)

**Supprimer ou déplacer dans `src/_legacy/`** :
- `components/notebooks/*` (sauf si tu réutilises comme Knowledge Base viewer → alors déplace dans `components/knowledge/`)
- `components/github/*` (garder uniquement `WorkspacePublishPanel` si tu veux publier des rapports)
- `components/templates/*`, `components/workflows/VisualWorkflowBuilder.tsx`
- `views/NotebooksView.tsx`, `GitHubView.tsx`, `AutomationView.tsx`, `DocumentsView.tsx`, `ListsView.tsx`, `MemoriesView.tsx` → **conserver** uniquement ce qui sert au rapport d'audit.

**Créer les nouvelles vues** :
```
src/views/
├── ScanView.tsx              # Lancer/configurer un scan
├── FindingsView.tsx          # Table des vulnérabilités (filtres CWE/severity/status)
├── FindingDetailView.tsx     # Détail d'une vuln : code, PoC, remediation
├── AttackSurfaceView.tsx     # Carte du graphe d'attaque (dérivé ASTCallGraph)
├── ReportView.tsx            # Génération/export SARIF/HTML/PDF
├── RulesView.tsx             # Gestion des rules packs
└── SettingsView.tsx          # Réduit : scope, exclude paths, providers LLM
```

**Nouvelles routes** (remplacent `/ide`, `/notebooks`, etc.) :
```
/scan          /findings          /findings/:id
/surface       /report            /rules
/settings
```

### Phase 2 — Spécialiser les rôles d'agents (2–3 j)

Dans `server/agents/roles.ts`, remplace les 15 rôles généralistes par une flotte **exclusivement security** :

```ts
export const STATIC_AGENT_ROLES = [
  // ── Reconnaissance & modélisation ──
  "recon",            // cartographie du code (entry points, surfaces d'attaque)
  "threat_modeler",   // STRIDE / MITRE ATT&CK mapping
  "architect_sec",    // analyse d'architecture (trust boundaries)

  // ── Analyse statique (SAST) ──
  "sast_analyzer",    // taint analysis, injection patterns
  "crypto_auditor",   // usages cryptographiques, entropie, RNG
  "auth_auditor",     // authn/authz, sessions, JWT, OAuth
  "secrets_hunter",   // détection de secrets (tokens, keys, credentials)

  // ── Supply chain (SCA) ──
  "sca_analyzer",     // CVE, EPSS, licence, typosquatting
  "sbom_builder",     // génération SBOM CycloneDX/SPDX

  // ── Infrastructure (IaC) ──
  "iac_auditor",      // Terraform, K8s, Docker, CloudFormation

  // ── Runtime (DAST — optionnel) ──
  "dast_runner",      // fuzzing API (OpenAPI), Puppeteer

  // ── Triage & rapport ──
  "triage",           // dédupe, priorisation, faux positifs
  "poc_writer",       // écriture de PoC **non-exploitables** (démonstratifs)
  "report_writer",    // rapport exécutif + technique + SARIF
];
```

Chaque rôle déclare **uniquement** les outils de son domaine. Un `sast_analyzer` n'a **aucun** accès à `write_project_file` — il est en read-only strict.

### Phase 3 — Transformer les skills (5–8 j)

Remplace `server/skills/securityAudit.ts` (un seul skill) par un **dossier de scanners** :

```
server/skills/security/
├── sast/
│   ├── taintAnalyzer.ts          # ← NOUVEAU (le plus critique)
│   ├── injectionScanner.ts       # SQLi, NoSQLi, Command Inj, LDAP
│   ├── xssScanner.ts
│   ├── ssrfScanner.ts
│   ├── deserializationScanner.ts
│   ├── pathTraversalScanner.ts
│   └── rules/
│       ├── cwe-79.ts
│       ├── cwe-89.ts
│       └── ...                   # 1 fichier par CWE
├── sca/
│   ├── dependencyScanner.ts      # lit package-lock.json / requirements.txt
│   ├── cveResolver.ts            # appel OSV.dev / NVD / GitHub Advisory
│   ├── epssClient.ts             # score EPSS (FIRST.org)
│   ├── kevClient.ts              # CISA Known Exploited Vulnerabilities
│   └── licenseScanner.ts
├── secrets/
│   ├── regexScanner.ts           # entropie + patterns (AWS/GCP/JWT/…)
│   └── allowlist.ts
├── iac/
│   ├── dockerfileScanner.ts
│   ├── k8sScanner.ts
│   └── terraformScanner.ts
├── dast/
│   ├── apiFuzzer.ts              # ← V2 (nécessite opt-in explicite)
│   └── headerScanner.ts
├── normalize/
│   ├── sarifBuilder.ts           # ← NOUVEAU — sortie standard
│   └── findingDedupe.ts
└── score/
    ├── cvssCalculator.ts         # CVSS 3.1 vector → score
    ├── epssIntegrator.ts
    └── priorityEngine.ts         # CVSS × EPSS × KEV × exploitabilité
```

**Important** : le `taintAnalyzer` s'appuie sur ton `ASTCallGraph.ts` et `RelationExtractor.ts` existants. C'est là qu'est le vrai gain — tu as déjà les fondations, il ne manque que la propagation source → sink.

### Phase 4 — Security Orchestrator (2–3 j)

Renomme/adapte `LeannaCore` → `SecurityOrchestrator` dans `server/security/orchestrator/` :

```ts
// server/security/orchestrator/SecurityOrchestrator.ts
export class SecurityOrchestrator {
  // ex-PerceptionEngine → ScanTriggerEngine (commit hook, cron, API)
  // ex-TaskManager → ScanQueue (1 scan par repo, priorité sur diff)
  // ex-GoalManager → FindingManager (dédupe par fingerprint SARIF)
  // ex-AutonomyPolicy → ScanPolicy (scope, excludes, severity threshold)

  async runScan(target: string, profile: ScanProfile): Promise<ScanResult> {
    const plan = await this.brain.planScan(target, profile);   // réutilise AgentBrain
    const findings = await this.scheduler.execute(plan);       // réutilise BrainScheduler
    return this.reportEngine.build(findings);                  // nouveau
  }
}
```

**Réutilise tel quel** : `AgentBrain`, `BrainScheduler`, `BrainPlanValidator`, `AgentRepairLoop` (pour les faux positifs), `Mission`, `Executor`, `WorkspaceState` (hash SHA-256 → empêche de rescanner un fichier inchangé), `EventBus`, `TelemetryService`.

### Phase 5 — Frontend Security Console (5–8 j)

Composants clés à créer :

```tsx
// src/components/security/
├── FindingCard.tsx              // CWE icon, severity, EPSS, KEV badge
├── SeverityBadge.tsx            // CVSS/OWASP color coding
├── CodeSnippet.tsx              // Monaco read-only avec surlignage ligne vulnérable
├── TaintFlowViz.tsx             // diagramme source → propagation → sink
├── AttackSurfaceGraph.tsx       // réutilise ton ASTCallGraph (D3/Mermaid)
├── RemediationPanel.tsx         // patch proposé (diff), références CWE
├── SbomTable.tsx                // dépendances + CVE + licence
└── SarifExportDialog.tsx
```

Réutilise :
- `Monaco Editor` (déjà présent) en mode read-only
- `Recharts` (déjà présent) pour les dashboards (severity distribution, trend)
- `Mermaid` (déjà présent) pour les taint flows

### Phase 6 — Formats & conformité (3–5 j)

- **SARIF 2.1.0** en sortie canonique (compatible GitHub Code Scanning, VS Code, DefectDojo)
- **SBOM** CycloneDX 1.5 + SPDX 2.3
- **Mapping obligatoire** : chaque finding → CWE + OWASP Top 10 2021 + MITRE ATT&CK (si applicable)
- **Rapports** : `htmlExporter.ts`, `pdfExporter.ts`, `docxExporter.ts` existent déjà → réutilise-les en changeant les templates

---

## 4. Changements concrets fichier par fichier

### À créer (priorité haute)

```
server/security/
├── orchestrator/
│   ├── SecurityOrchestrator.ts        # ex-LeannaCore
│   ├── ScanTriggerEngine.ts           # ex-PerceptionEngine
│   ├── ScanQueue.ts                   # ex-TaskManager
│   ├── ScanPolicy.ts                  # ex-AutonomyPolicy
│   └── FindingManager.ts              # ex-GoalManager
├── findings/
│   ├── Finding.ts                     # modèle normalisé
│   ├── Fingerprint.ts                 # hash stable pour dédupe
│   ├── SeverityScorer.ts              # CVSS + EPSS + KEV
│   └── CweMapper.ts                   # finding → CWE/OWASP
├── scanners/
│   ├── TaintAnalyzer.ts               # ⭐ le cœur du réacteur
│   ├── DependencyScanner.ts
│   ├── SecretsScanner.ts
│   └── IacScanner.ts
├── rules/
│   ├── RuleEngine.ts
│   ├── Rule.ts
│   └── packs/
│       ├── owasp-top10-2021/
│       ├── cwe-top25/
│       └── cisa-kev/
├── reporting/
│   ├── SarifBuilder.ts
│   ├── SbomBuilder.ts
│   └── ReportComposer.ts
└── integrations/
    ├── OsvClient.ts                   # OSV.dev API
    ├── NvdClient.ts
    ├── EpssClient.ts
    └── GithubAdvisoryClient.ts
```

### À modifier

| Fichier | Modification |
|---|---|
| `server/agents/roles.ts` | Nouveaux rôles security (cf. Phase 2), retirer les non-security |
| `server/skills/securityAudit.ts` | Scinder en `server/skills/security/*` |
| `server/agents/brain/DynamicPlanner.ts` | Phases dédiées : `recon`, `sast`, `sca`, `iac`, `triage`, `report` |
| `server/mission/Executor.ts` | Retirer `generateArgs` générique → args pilotés par rules packs |
| `server/runtime/PermissionPolicy.ts` | Durcir : SAST = read-only strict ; DAST = opt-in explicite |
| `server/autonomy/LeannaCore.ts` | Renommer/déplacer vers `security/orchestrator/` |
| `src/views/IdeView.tsx` | Dégradé en `FindingDetailView` (mode read-only) |
| `package.json` | Nom, description, scripts (`scan`, `scan:diff`, `sbom`) |
| `.env.example` | Ajouter `OSV_API_URL`, `NVD_API_KEY`, `EPSS_API_URL`, `SARIF_OUTPUT_DIR`, `SCAN_PROFILE` |

### À supprimer (ou `_legacy/`)

```
server/skills/{writer,formatter,proofreader,translator,summarizer}*.ts
server/agents/roles.ts → coder, refactor, writer, translator, …
src/views/{NotebooksView, ListsView, MemoriesView, DocumentsView}.tsx
src/components/notebooks/*        (sauf si Knowledge Base viewer)
src/components/github/GitHubPanel.tsx
src/components/workflows/*
scripts/test-agent-missions.mjs   → remplacé par un harness de scan
```

---

## 5. Ce que tu NE dois pas toucher

Ces modules sont **déjà excellents** pour la sécurité et n'ont pas besoin d'être refondus :

- `server/utils/sandbox.ts` — isolation parfaite (fail-closed, anti-symlink, checkpoint)
- `server/runtime/PermissionPolicy.ts` + `DryRun.ts` + `ToolRegistry.ts` — le triptyque de sécurité runtime est nickel
- `server/agents/WorkspaceState.ts` — hash SHA-256 + verification record = **exactement** ce qu'il faut pour un scan incrémental
- `server/agents/brain/BrainScheduler.ts` — DAG topologique parallèle = parfait pour orchestrer N scanners
- `server/knowledge/ASTParser.ts` + `ASTCallGraph.ts` — la base du taint
- `server/observability/TelemetryService.ts` — coût/tokens par mission = réutilisable pour facturation d'un scan
- `server/security.ts` (timing-safe auth) — à garder tel quel

---

## 6. Roadmap d'exécution suggérée

| Semaine | Objectif |
|---|---|
| S1 | Phase 0 + Phase 1 (élagage frontend, contrats) |
| S2 | Phase 2 (rôles security) + Phase 3 partielle (taint analyzer v0 sur CWE-79/89) |
| S3 | Phase 3 complète (SCA + secrets + IaC) + intégration OSV/NVD/EPSS |
| S4 | Phase 4 (SecurityOrchestrator) + SARIF builder |
| S5 | Phase 5 (Security Console UI) |
| S6 | Phase 6 (formats + rapports) + tests end-to-end sur OWASP Benchmark / Juice Shop |

---

## 7. Points d'attention

1. **Ne pas casser le sandbox** : un scan ne doit jamais écrire dans le workspace. Le mode read-only strict est déjà là — utilise-le.
2. **PoC = démonstratif, jamais exploitable** : ta `promptInjectionGuard.ts` est là pour ça — applique-la aux sorties de `poc_writer`.
3. **Faux positifs** : le `AgentRepairLoop` peut être détourné pour demander à un second agent de valider chaque finding (2-of-3).
4. **Coût LLM** : le taint analysis doit être **AST-first, LLM-second**. Ne fais appeler le LLM que sur les chemins suspects (SIG: sink atteint depuis une source non validée).
5. **Conformité** : si l'audit est vendu à des clients, ajoute un mode « air-gapped » (Ollama, cf. R3 de ta ROADMAP) — tes rapports doivent pouvoir être générés sans réseau.

---

## 8. Résumé exécutif

> **Leanna n'a pas besoin d'être réécrit pour devenir un auditeur de sécurité.**
> Il faut :
> 1. **Retirer** les vues généralistes (notebooks, workflows, github, documents)
> 2. **Spécialiser** les rôles d'agents (11 rôles security au lieu de 15 généralistes)
> 3. **Étendre** `securityAudit.ts` en **12 scanners** organisés par famille (SAST/SCA/secrets/IaC/DAST)
> 4. **Ajouter** 4 briques critiques : taint analysis, CVE/OSV integration, SARIF export, scoring CVSS+EPSS+KEV
> 5. **Renommer** `LeannaCore` → `SecurityOrchestrator` et adapter la boucle (scan au lieu de mission générique)
>
> Le backend de sécurité runtime (sandbox, permissions, dry-run, hash SHA-256, DAG) est déjà production-grade. C'est une **refonte chirurgicale**, pas un pivot destructeur.

Si tu veux, je peux détailler l'implémentation d'un module en particulier — le `TaintAnalyzer` (le plus stratégique) ou le `SarifBuilder` (le plus critique pour l'interopérabilité). Dis-moi par où tu veux commencer.