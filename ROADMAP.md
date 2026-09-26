# Roadmap — Leanna Security Operating System

Cette roadmap décrit la trajectoire produit de Leanna : ce qui est **livré**, ce qui est **en cours** et ce qui est **prévu**. Elle est organisée par capacité (moteurs, orchestration, agents, reporting, conformité, UX) plutôt que par date, pour rester lisible au fil des itérations.

Légende de statut : ✅ livré · 🚧 en cours · 🔭 prévu · 💡 exploratoire

---

## 1. Vision

Leanna est un système d'exploitation d'audit de sécurité **local, non destructif et lecture seule par défaut**. L'objectif est de couvrir la chaîne complète — de la reconnaissance à la remédiation — avec une traçabilité stricte (preuve `file.ts:ligne`, CWE/OWASP, CVSS/EPSS/KEV) et des exports conformes aux standards de l'industrie (SARIF 2.1.0, CycloneDX 1.5).

Principes directeurs :
- **Preuve ou rien** : aucun finding sans emplacement reproductible.
- **Non-destructif** : aucune exploitation réelle, aucun secret divulgué en clair.
- **Confinement** : toute écriture (rapports, PoC) est isolée dans la sandbox.
- **Déterminisme** : deux analyses des mêmes sources produisent le même résultat.

---

## 2. Moteurs d'analyse

| Capacité | Statut | Détail |
|---|---|---|
| SAST — Taint Analysis (AST-first) | ✅ | `TaintAnalyzer` : sources → propagation → sinks ; CWE-89/78/22/918/94/79. |
| SCA — Supply Chain (OSV/NVD) | ✅ | `DependencyScanner` : CVE, enrichissement EPSS/KEV en ligne, inventaire SBOM. |
| Secrets Hunter (entropie de Shannon) | ✅ | `SecretsScanner` : clés AWS/GCP/GitHub/Stripe/OpenAI, clés privées. |
| IaC (Docker / K8s / Terraform) | ✅ | `IacScanner` : root container, tags `latest`, privileged, SG exposés. |
| DAST — Fuzzing d'API (opt-in) | 🚧 | Runner runtime non destructif ; validation dynamique des findings SAST. |
| SAST inter-procédural (call-graph) | 🔭 | Propagation de taint à travers les frontières de fonctions/fichiers. |
| Analyse de licences (compatibilité) | 🔭 | Détection GPL/copyleft dans un contexte propriétaire. |
| Détection de typosquats (dépendances) | 💡 | Similarité de noms vs registres connus. |

---

## 3. Orchestration & politique

| Capacité | Statut | Détail |
|---|---|---|
| Orchestrateur central + file d'attente | ✅ | `SecurityOrchestrator` + `ScanQueue` (priorités par déclencheur). |
| Profils de scan (quick / standard / full / custom) | ✅ | `ScanPolicy` : scanners, plafonds, timeouts, seuil bloquant. |
| Scan incrémental (cache SHA-256 / diff) | ✅ | `ScanTriggerEngine` : ne rescanne que les fichiers altérés. |
| Déduplication & triage des findings | ✅ | `FindingManager` : fingerprint SHA-256, préservation des états de triage. |
| **Gate bloquant réservé au CI/CD** | ✅ | Bloque uniquement sur `git_commit` / `pre_push` ; les scans `api`/`cron`/`file_change` sont informatifs. |
| Audit continu (debounce, événements) | ✅ | `ContinuousAuditManager` : audits automatiques sur événements. |
| Seuils bloquants configurables par l'utilisateur | 🔭 | Override du `blockingSeverity` par projet / par équipe. |
| Planification cron native | 🔭 | Audits périodiques programmés depuis l'UI. |

---

## 4. Flotte d'agents spécialisés

| Capacité | Statut | Détail |
|---|---|---|
| 14 rôles sécurité dédiés | ✅ | recon, threat_modeler, architect_sec, sast_analyzer, crypto_auditor, auth_auditor, secrets_hunter, sca_analyzer, sbom_builder, iac_auditor, dast_runner, triage, poc_writer, report_writer. |
| **Prompts système par rôle** | ✅ | `buildSecurityAgentPrompt` : doctrine partagée + contrat de finding JSON strict + format de sortie normalisé, un prompt distinct par rôle. |
| **Matrice de délégation chaînée** | ✅ | `DELEGATION_MATRIX` : recon → threat_modeler → analyseurs → triage → poc_writer → report_writer. |
| Lecture seule stricte + 2 exceptions encadrées | ✅ | `report_writer` (rapports) et `poc_writer` (PoC) écrivent uniquement des artefacts, confinés à la sandbox. |
| Modélisation de menaces STRIDE / MITRE | 🚧 | `threat_modeler` : sortie structurée exploitable par les analyseurs aval. |
| Triage assisté par IA (clustering de causes) | 🔭 | Regroupement par cause racine, priorisation par risque réel. |

---

## 5. Reporting & conformité

| Capacité | Statut | Détail |
|---|---|---|
| Export SARIF 2.1.0 | ✅ | `SarifBuilder` : compatible GitHub Code Scanning / DefectDojo. |
| SBOM CycloneDX 1.5 (JSON) | ✅ | `SbomBuilder` : composants, versions, PURL, vulnérabilités. |
| **Rapport Markdown exécutif** | ✅ | `MarkdownReportBuilder` : synthèse, tableau de bord, top risques, fiches par finding, secrets masqués. |
| **Écriture auto des rapports dans la sandbox** | ✅ | `ReportWriter` : `rapport.md` + `rapport.sarif.json` après chaque scan, via SandboxGuard, non bloquant. |
| Priorisation CVSS 3.1 × EPSS × KEV | ✅ | `SeverityScorer`. |
| SBOM SPDX | 🔭 | Format complémentaire pour la conformité. |
| Enrichissement EPSS/KEV hors-ligne | 🔭 | Base locale pour les environnements air-gapped. |
| Intégration GitHub Code Scanning native | 🔭 | Upload SARIF automatisé + annotations de PR. |
| Historique de posture & tendances | 🔭 | `SecurityPostureTracker` étendu : évolution du risque dans le temps. |

---

## 6. Sandbox & confinement

| Capacité | Statut | Détail |
|---|---|---|
| Sandbox miroir isolée (`.Leanna/sandbox/`) | ✅ | Copie du projet ; écritures agent confinées, fail-closed. |
| SandboxGuard (anti-échappement, anti-symlink) | ✅ | `assertSafeSandboxPath` : chemin relatif validé, état `READY` requis. |
| Cible par défaut = sandbox dans l'UI de scan | ✅ | `ScanView` sélectionne la sandbox par défaut. |
| Sync sélective sandbox → workspace | ✅ | `syncToMain` / `acceptFile` transactionnels avec checkpoint. |
| Option : publier le rapport vers le workspace | 🔭 | Flux d'acceptation explicite du rapport hors sandbox. |

---

## 7. Prompts & runtime

| Capacité | Statut | Détail |
|---|---|---|
| Compilateur de prompt système (règles + sections) | ✅ | `SystemPromptBuilder` : scope, priorité, résolution de conflits. |
| **Parser de frontmatter YAML** | ✅ | `loader.ts` : YAML (`---`) + legacy HTML-comment, extraction typée (`id`, `priority`, `always`, `condition`, `appliesTo`, `tokensBudget`). |
| **Sélection de sections pilotée par le frontmatter** | ✅ | `syncSectionsFromLegacy` : priorité/scope/condition/ciblage de rôle dérivés des fichiers `.md`. |
| Migration des prompts legacy vers YAML | 🔭 | Convertir `ai-studio-directives.md` et retirer les tables de repli. |

---

## 8. Expérience utilisateur (Console)

| Capacité | Statut | Détail |
|---|---|---|
| Vues Scan / Findings / Détail / Surface / Report / Rules | ✅ | Console React 19 complète. |
| Code Viewer Monaco lecture seule | ✅ | Inspection sans risque de modification. |
| Graphe de surface d'attaque (risque dérivé des findings) | ✅ | `getAttackSurface` : nœuds/arêtes, score par pondération de sévérité. |
| Packs de règles configurables (OWASP/CWE/KEV/IaC) | 🚧 | `RulesView` : activation/désactivation par pack. |
| Visualisation du rapport sandbox dans l'UI | 🔭 | Rendu de `rapport.md` directement dans `/report`. |
| Diff de posture entre deux scans | 🔭 | Comparaison findings ajoutés/résolus. |

---

## 9. Corrections récentes

- **Gate bloquant abusif** — un scan `full` à la demande bloquait dès qu'une CVE `medium` existait dans les dépendances transitives (`BLOCKED | 24 findings (0C 0H)`). Le gate est désormais réservé aux déclencheurs CI/CD (`git_commit` / `pre_push`) ; les scans manuels restent `completed` et informatifs.
- **Rapports non persistés** — l'orchestrateur générait SARIF/SBOM en mémoire sans jamais les écrire. Les rapports sont maintenant écrits automatiquement dans `.Leanna/sandbox/security-reports/`.
- **Frontmatter des prompts ignoré** — le parser ne comprenait que l'ancien format HTML-comment ; le bloc YAML fuitait dans le contenu. Le parser gère désormais les deux formats et alimente réellement la sélection de sections.
- **Capacités fantômes** — l'agent `security` déclarait `security_audit` / `security_sast` / `security_sca` absents de l'allowlist `EXECUTABLE_AGENT_TOOLS` ; ces outils réels y sont désormais enregistrés.

---

_Dernière mise à jour : 26 septembre 2026._
