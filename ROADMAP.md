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
| DAST — Fuzzing d'API (opt-in) | ✅ | `DastScanner` : runner runtime non destructif (GET/HEAD/OPTIONS uniquement, timeouts/plafonds), gate `canRunDast` (localhost autorisé, prod refusée) ; en-têtes manquants, banner disclosure, redirection HTTP, cookies non sécurisés, 5xx ; validation dynamique des findings SAST (corroboration → `confirmed`). |
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
| **Modélisation de menaces STRIDE / MITRE** | ✅ | `ThreatModelEngine` : points d'entrée découverts statiquement, menaces STRIDE dérivées des findings, **mapping MITRE ATT&CK** par menace et **matrice de couverture STRIDE par point d'entrée**. Exposé via `GET /api/security/threat-model` et fusionné dans `GET /api/security/graph`. |
| **Triage assisté (clustering de causes)** | ✅ | `TriageClusterEngine` : regroupement déterministe par cause racine (CWE + localité / paquet / type de secret) et priorisation par **risque réel** (sévérité × volume × exploitabilité KEV/DAST/EPSS). Exposé via `GET /api/security/triage/clusters`. |

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
| **Packs de règles configurables (OWASP/CWE/KEV/IaC)** | ✅ | `RulesView` + `RuleEngine` : 4 packs (OWASP Top 10, CWE Top 25, CISA KEV, IaC Baseline) ; activation/désactivation persistée (`.Leanna/rule-packs.json`) et **effective au scan** — les findings d'un pack désactivé sont filtrés avant ingestion (fail-open pour les familles non couvertes). |
| Visualisation du rapport sandbox dans l'UI | 🔭 | Rendu de `rapport.md` directement dans `/report`. |
| Diff de posture entre deux scans | 🔭 | Comparaison findings ajoutés/résolus. |

---

## 9. Corrections récentes

- **Modélisation de menaces branchée + enrichie (STRIDE/MITRE)** — le `ThreatModelEngine` existait et était testé, mais restait inaccessible : aucune route HTTP ne l'exposait, si bien que la sortie n'était « exploitable par les analyseurs aval » qu'en théorie. De plus, la sortie n'incluait ni mapping MITRE ATT&CK ni vision de couverture. Désormais : chaque menace porte une technique MITRE (`mitreForFinding`, `null` explicite quand aucune ne s'applique — pas de remplissage arbitraire), le modèle expose une matrice de couverture STRIDE par point d'entrée, et trois endpoints REST publient le tout (`/threat-model`, `/graph`, et la fusion dans le graphe de sécurité unifié).
- **Triage assisté par regroupement de causes racines** — les findings étaient listés à plat, sans regroupement ni priorisation par risque réel. Le nouveau `TriageClusterEngine` regroupe de façon déterministe les findings partageant une même cause (CWE + répertoire pour le SAST/IaC, paquet pour le SCA, type de secret pour les secrets) et attribue à chaque grappe un score de risque 0–100 combinant sévérité maximale, volume d'occurrences et multiplicateurs d'exploitabilité (CISA KEV, corroboration DAST, EPSS). Exposé via `/triage/clusters` ; couvert par des tests unitaires (fusion, séparation, déterminisme, élévation du risque KEV/confirmé).
- **Packs de règles rendus effectifs (OWASP/CWE/KEV/IaC)** — la capacité était une coquille d'UI : `RulesView` affichait des toggles et le `RuleEngine` gérait bien `setPackEnabled`, mais (1) l'état n'était pas persisté et repartait à zéro au redémarrage, (2) aucun scanner ne consultait l'état des packs — désactiver OWASP ne changeait rien aux findings, et (3) le pack IaC annoncé dans le titre n'existait pas. Désormais : l'état activé/désactivé est persisté dans `.Leanna/rule-packs.json` (rechargé au démarrage) ; l'orchestrateur filtre les `rawFindings` avant ingestion via `ruleEngine.filterFindings`, en rattachant chaque finding à ses packs par `ruleId`/CWE/OWASP (un finding est écarté seulement si tous les packs qui le revendiquent sont désactivés, fail-open sinon) ; et un pack `iac-baseline` réel (Docker root, tag latest, pod privilégié, ingress ouvert) est enregistré et mappé sur les `ruleId` émis par `IacScanner`.
- **DAST livrée (opt-in, non destructive)** — la capacité restait une coquille : la politique (`canRunDast`, classification de cible) et le rôle `dast_runner` existaient, mais aucun scanner ne tournait et le flag `dast: true` du profil `full` était inerte. Le `DastScanner` réel est désormais branché dans l'orchestrateur (étape 4bis), derrière une triple porte (scanner actif + opt-in explicite + `canRunDast === allow`). Il n'émet que des requêtes d'observation inoffensives (GET/HEAD/OPTIONS, redirections manuelles, timeouts et plafond de requêtes) et corrobore dynamiquement les findings SAST exposés en HTTP, les promouvant de `open` à `confirmed` sans jamais les exploiter. Cible acceptée en automatique : localhost ; staging/inconnu → approbation ; production → refus.
- **Gate bloquant abusif** — un scan `full` à la demande bloquait dès qu'une CVE `medium` existait dans les dépendances transitives (`BLOCKED | 24 findings (0C 0H)`). Le gate est désormais réservé aux déclencheurs CI/CD (`git_commit` / `pre_push`) ; les scans manuels restent `completed` et informatifs.
- **Rapports non persistés** — l'orchestrateur générait SARIF/SBOM en mémoire sans jamais les écrire. Les rapports sont maintenant écrits automatiquement dans `.Leanna/sandbox/security-reports/`.
- **Frontmatter des prompts ignoré** — le parser ne comprenait que l'ancien format HTML-comment ; le bloc YAML fuitait dans le contenu. Le parser gère désormais les deux formats et alimente réellement la sélection de sections.
- **Capacités fantômes** — l'agent `security` déclarait `security_audit` / `security_sast` / `security_sca` absents de l'allowlist `EXECUTABLE_AGENT_TOOLS` ; ces outils réels y sont désormais enregistrés.

---

_Dernière mise à jour : 26 septembre 2026 — Modélisation de menaces STRIDE/MITRE et triage assisté par clustering de causes livrés._
