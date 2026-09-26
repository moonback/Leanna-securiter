# Leanna — Security Operating System (Audit & Analyse de Vulnérabilités)

<img src="assets/images/Architecture_d_un_système_agentique_IA.png" alt="Leanna-Security-OS" />

> **Leanna est un système d’exploitation spécialisé dans l’audit de sécurité automatisé et l’analyse de vulnérabilités logicielle. Il intègre une Console de Sécurité complète, une flotte d’agents d’audit en lecture seule stricte, des moteurs d’analyse SAST (Taint Analysis), SCA (Supply Chain), Secrets et IaC, la cartographie de surface d'attaque, et la génération de rapports conformes aux standards internationaux (SARIF 2.1.0, CycloneDX 1.5 SBOM).**

Leanna réunit une application frontend React 19 / Vite, un serveur Express sécurisé avec API REST et WebSockets, ainsi qu’une application desktop Electron. Conçu pour auditer des dépôts en local ou en environnement isolé (Sandbox), Leanna garantit une étanchéité totale : les scans s'exécutent en lecture seule et protègent vos codes sources contre toute altération.

![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-339933?logo=node.js&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=111)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Electron](https://img.shields.io/badge/Electron-43-47848F?logo=electron&logoColor=white)
![SARIF](https://img.shields.io/badge/SARIF-2.1.0-blue)
![CycloneDX](https://img.shields.io/badge/CycloneDX-1.5-green)
![Licence](https://img.shields.io/badge/licence-BUSL--1.1-orange)

---

## Sommaire

- [Console de Sécurité & Vues](#console-de-sécurité--vues)
- [Moteurs d'Analyse & Scanners](#moteurs-danalyse--scanners)
- [Flotte d'Agents Sécurité Spécialisés](#flotte-dagents-sécurité-spécialisés)
- [Architecture Cible](#architecture-cible)
- [Mode Sandbox Isolé (Offline Sécurisé)](#mode-sandbox-isolé-offline-sécurisé)
- [Standards & Conformité (SARIF, SBOM, CVSS/EPSS)](#standards--conformité-sarif-sbom-cvssepss)
- [API de Sécurité](#api-de-sécurité)
- [Stack technique](#stack-technique)
- [Prérequis](#prérequis)
- [Installation & Lancement](#installation--lancement)
- [Tests et Qualité](#tests-et-qualité)
- [Structure du Dépôt](#structure-du-dépôt)
- [Licence](#licence)

---

## Console de Sécurité & Vues

Leanna propose une interface dédiée aux auditeurs de sécurité, consultants et développeurs, articulée autour de 6 modules principaux :

| Route | Vue | Description |
|---|---|---|
| `/scan` | **Audit & Scan** ([`ScanView.tsx`](src/views/ScanView.tsx)) | Configuration et lancement d'audits. Profils prédéfinis (*Rapide*, *Standard*, *Complet*), sélection modulaire des scanners, et reprise automatique de la **Sandbox isolée** comme cible par défaut. |
| `/findings` | **Vulnérabilités** ([`FindingsView.tsx`](src/views/FindingsView.tsx)) | Tableau de bord exhaustif des vulnérabilités découvertes, filtres par sévérité (*Critical, High, Medium, Low*), recherche et badges CWE / OWASP Top 10. |
| `/findings/:id` | **Détail d'une Vulnérabilité** ([`FindingDetailView.tsx`](src/views/FindingDetailView.tsx)) | Fiche technique détaillée avec chronologie du **Taint Flow** (*Source ➔ Propagation ➔ Sink*), extrait de code surligné, impact, remédiation et gestion du statut de triage (*Confirmé*, *Faux positif*, *Corrigé*, *Ignoré*). |
| `/surface` | **Surface d'Attaque** ([`AttackSurfaceView.tsx`](src/views/AttackSurfaceView.tsx)) | Cartographie interactive et graphe des flux (points d'entrée API, flux WebSocket, Sandbox, bases de données et services externes). |
| `/report` | **Rapports & Exports** ([`ReportView.tsx`](src/views/ReportView.tsx)) | Génération et téléchargement de rapports normalisés : **SARIF 2.1.0** (GitHub Code Scanning, DefectDojo), **SBOM CycloneDX 1.5 JSON**, Markdown exécutif ou JSON brut. |
| `/rules` | **Règles & Packs** ([`RulesView.tsx`](src/views/RulesView.tsx)) | Gestionnaire des packs de règles de sécurité (OWASP Top 10 2021, CWE Top 25, CISA KEV, Sécurité IaC). |
| `/code-viewer` | **Code Viewer** ([`IdeView.tsx`](src/views/IdeView.tsx)) | Visualiseur Monaco en mode **lecture seule stricte** pour inspecter les fichiers suspects sans risque de modification accidentelle. |

---

## Moteurs d'Analyse & Scanners

Leanna combine 5 moteurs d'analyse intégrés dans le [`SecurityOrchestrator`](server/security/orchestrator/SecurityOrchestrator.ts) :

### 1. Analyse Statique & Taint Analysis (SAST)
* **Moteur :** [`TaintAnalyzer.ts`](server/security/scanners/TaintAnalyzer.ts)
* **Principe :** Analyse du flux de données (AST-first, propagation de variables) traçant les entrées non fiables (*Sources* : `req.query`, `req.body`, `req.params`, `req.headers`, `window.location`) jusqu'aux points de chute dangereux (*Sinks* non assainis).
* **Faiblesses couvertes :**
  * **CWE-89** : Injection SQL (concaténation dynamique dans `db.query`, `sequelize`, etc.)
  * **CWE-78** : Injection de commande système (`exec`, `spawn`, `execSync`)
  * **CWE-22** : Traversée de répertoire / Path Traversal (`fs.readFile`, `path.join`)
  * **CWE-918** : Server-Side Request Forgery (`fetch`, `axios`, `http.get`)
  * **CWE-94** : Injection de code dynamique (`eval`, `new Function`, `vm.runInContext`)
  * **CWE-79** : Cross-Site Scripting réfléchi (`dangerouslySetInnerHTML`, `innerHTML`, `res.send`)

### 2. Supply Chain & Dépendances (SCA)
* **Moteur :** [`DependencyScanner.ts`](server/security/scanners/DependencyScanner.ts)
* **Principe :** Analyse de `package.json` et des locks, corrélation avec les bases de vulnérabilités connues (NVD, OSV.dev), calcul des probabilités d'exploitation (score **EPSS**) et indicateur **CISA KEV** (failles activement exploitées).
* **Inventaire :** Extraction automatique des composants logiciels pour la création du SBOM.

### 3. Chasseur de Secrets (Secrets Hunter)
* **Moteur :** [`SecretsScanner.ts`](server/security/scanners/SecretsScanner.ts)
* **Principe :** Détection d'identifiants, clés d'API et jetons avec calcul d'**entropie de Shannon** pour éliminer les faux positifs :
  * Clés AWS (`AKIA...`), GitHub PAT (`ghp_...`), Google API Keys (`AIza...`), Slack Tokens, Stripe, OpenAI (`sk-...`), clés privées RSA/EC/SSH (`-----BEGIN PRIVATE KEY-----`).

### 4. Infrastructure as Code (IaC)
* **Moteur :** [`IacScanner.ts`](server/security/scanners/IacScanner.ts)
* **Principe :** Détection de défauts de configuration et failles d'élévation de privilèges :
  * **Dockerfile** : Conteneurs exécutés en root (absence de `USER`), tags non épinglés (`latest`).
  * **Kubernetes** : Conteneurs en mode privilégié (`securityContext.privileged: true`).
  * **Terraform** : Groupes de sécurité exposant SSH (22) ou RDP (3389) sur `0.0.0.0/0`.

### 5. Runtime Fuzzing (DAST — Optionnel)
* Détection active et fuzzing d'API via requêtes ciblées avec opt-in explicite.

---

## Flotte d'Agents Sécurité Spécialisés

Pour orchestrer les audits complexes et la modélisation des menaces, Leanna remplace les agents généralistes par une **flotte d'experts sécurité dédiés** ([`roles.ts`](server/agents/roles.ts)) :

```text
recon ➔ threat_modeler ➔ sast_analyzer ➔ triage ➔ poc_writer ➔ report_writer
  │                             │
  └── architect_sec             └── sca_analyzer ➔ sbom_builder
```

* **`recon`** : Cartographie du code, identification des points d'entrée et surfaces d'attaque.
* **`threat_modeler`** : Modélisation des menaces selon les méthodologies STRIDE et MITRE ATT&CK.
* **`architect_sec`** : Analyse des frontières de confiance (*trust boundaries*) et des mécanismes d'isolation.
* **`sast_analyzer`** : Détection des flux de taint et des chemins d'injection.
* **`crypto_auditor`** : Audit des usages cryptographiques, de l'entropie et des générateurs aléatoires.
* **`auth_auditor`** : Contrôle des authentifications, des sessions, des jetons JWT et des protocoles OAuth.
* **`secrets_hunter`** : Recherche de credentials codés en dur.
* **`sca_analyzer`** : Évaluation de la supply chain et des CVEs tierces.
* **`sbom_builder`** : Production des inventaires CycloneDX / SPDX.
* **`iac_auditor`** : Audit des conteneurs, clusters Kubernetes et templates Terraform.
* **`triage`** : Déduplication et élimination des faux positifs.
* **`poc_writer`** : Rédaction de preuves de concept (PoC) **démonstratives et non-destructives**.
* **`report_writer`** : Synthèse exécutive, fiches techniques et exports normalisés.

> 🔒 **Garantie Lecture Seule :** Tous les agents de sécurité ont la propriété `roleCanWriteFiles === false`. Ils ne disposent d'aucun outil de modification de code (`write_project_file`, `modify_project_file`, `patch_project_file`), protégeant rigoureusement le code analysé.

---

## Architecture Cible

```text
                    ┌─────────────────────────────────────────┐
                    │  Security Console (UI React 19)         │
                    │  - /scan        : Lanceur d'audit       │
                    │  - /findings    : Triage & CVSS/EPSS    │
                    │  - /surface     : Carte d'attaque AST   │
                    │  - /code-viewer : Monaco en lecture     │
                    │  - /report      : SARIF / CycloneDX     │
                    └────────────────┬────────────────────────┘
                                     │ REST / WebSocket (/api/security/*)
                    ┌────────────────▼────────────────────────┐
                    │  Security Orchestrator                  │
                    │  - Scan Scheduler & Queue               │
                    │  - Finding Manager (Dedupe SHA-256)     │
                    │  - Policy Engine (Contrôle des accès)   │
                    └────────────────┬────────────────────────┘
                                     │
        ┌────────────────────────────┼────────────────────────────┐
        │                            │                            │
┌───────▼────────┐         ┌─────────▼──────────┐       ┌─────────▼────────┐
│ STATIC (SAST)  │         │ SUPPLY CHAIN (SCA) │       │ INFRA (IaC)      │
│ AST + Taint    │         │ CVE / EPSS / KEV   │       │ Dockerfile       │
│ Sinks & CWE    │         │ SBOM CycloneDX 1.5 │       │ K8s & Terraform  │
└────────────────┘         └────────────────────┘       └──────────────────┘
        │                            │                            │
        └────────────────────────────┼────────────────────────────┘
                                     │
                    ┌────────────────▼────────────────────────┐
                    │  Finding & Scoring Engine               │
                    │  - Normalisation SARIF 2.1.0            │
                    │  - Fingerprinting SHA-256 déterministe  │
                    │  - Priorisation : CVSS 3.1 × EPSS × KEV │
                    │  - Mapping CWE & OWASP Top 10 2021      │
                    └─────────────────────────────────────────┘
```

---

## Mode Sandbox Isolé (Offline Sécurisé)

Conformément à la directive d'audit offline sécurisé, Leanna propose un **mode Sandbox** :
- Une copie miroir du projet est maintenue dans `.Leanna/sandbox/`.
- Dans [`ScanView.tsx`](src/views/ScanView.tsx), le champ **Cible** sélectionne automatiquement la Sandbox par défaut.
- Un sélecteur permet de basculer en un clic entre :
  - **`🛡️ Sandbox (Recommandé)`** : Aucune interaction avec vos fichiers de développement.
  - **`📁 Workspace`** : Analyse directe du dossier racine.

---

## Standards & Conformité (SARIF, SBOM, CVSS/EPSS)

Chaque vulnérabilité détectée par Leanna est normalisée selon les standards industriels :

1. **Format SARIF 2.1.0 ([`SarifBuilder.ts`](server/security/reporting/SarifBuilder.ts)) :**
   * Compatible avec **GitHub Code Scanning**, VS Code SARIF Viewer et DefectDojo.
   * Contient la description complète, les tags CWE/OWASP, les localisations exactes et le cheminement de données (`codeFlows`).

2. **Inventaire SBOM CycloneDX 1.5 ([`SbomBuilder.ts`](server/security/reporting/SbomBuilder.ts)) :**
   * Format JSON standardisé listant les bibliothèques, versions, PURL (`pkg:npm/...`) et vulnérabilités associées.

3. **Priorisation du Risque ([`SeverityScorer.ts`](server/security/findings/SeverityScorer.ts)) :**
   * Score calculé combinant la sévérité intrinsèque (**CVSS 3.1**), la probabilité d'exploitation réelle (**EPSS**) et la présence dans le catalogue **CISA KEV** :
   $$\text{Score de Risque} = (\text{CVSS} \times 0.45) + (\text{EPSS} \times 0.35) + \text{Bonus KEV} (0.30)$$

---

## API de Sécurité

Le routeur de sécurité est monté sur `/api/security` dans [`server.ts`](server.ts) :

| Méthode | Endpoint | Rôle |
|---|---|---|
| `POST` | `/api/security/scan` | Déclenche un audit sur le projet (ou sandbox) avec les scanners choisis. |
| `GET` | `/api/security/scan/status` | Retourne l'état du scan en cours ou le résumé du dernier scan. |
| `GET` | `/api/security/findings` | Liste les vulnérabilités (avec filtres optionnels `severity`, `scanner`, `status`). |
| `GET` | `/api/security/findings/:id` | Récupère la fiche détaillée d'un finding avec son Taint Flow complet. |
| `PATCH`| `/api/security/findings/:id/status`| Met à jour le statut de triage (`confirmed`, `false_positive`, `fixed`, `ignored`). |
| `GET` | `/api/security/attack-surface` | Fournit les nœuds et arêtes du graphe de surface d'attaque. |
| `POST` | `/api/security/report` | Génère un export (`format: "sarif"`, `"cyclonedx"`, `"markdown"`, ou `"json"`). |

---

## Stack technique

| Technologie | Utilisation |
|---|---|
| React 19 | Interface utilisateur (Security Console) |
| React Router DOM 7 | Routage applicatif (`/scan`, `/findings`, etc.) |
| Vite 6 | Bundler et serveur de développement rapide |
| TypeScript 5 | Typage strict frontend & backend |
| Express 4 | API HTTP REST & Middleware |
| `ws` | WebSockets pour flux d'audit en temps réel |
| Electron 43 | Application desktop sécurisée |
| Monaco Editor | Code Viewer en lecture seule |
| Tree-sitter WASM | Parsing AST & Call-Graph pour Taint Analysis |
| Google GenAI / OpenRouter | Modélisation des menaces et analyse contextuelle |

---

## Prérequis

- Node.js **20 ou supérieur** ;
- npm compatible ;
- Git.

---

## Installation & Lancement

### 1. Installer les dépendances
```bash
git clone <URL_DU_DEPOT>
cd leanna
npm install
```

### 2. Configurer l'environnement
```bash
cp .env.example .env
```
*(Sur Windows PowerShell : `Copy-Item .env.example .env`)*

Définissez votre clé Gemini ou OpenRouter dans le fichier `.env` si vous souhaitez utiliser les fonctions de synthèse assistée par IA.

### 3. Démarrer en développement
```bash
npm run dev
```
L'application est accessible sur `http://127.0.0.1:4000` (redirection automatique sur `/scan`).

### 4. Démarrer l'application Desktop (Electron)
```bash
npm run desktop:debug
```

---

## Tests et Qualité

Le moteur de sécurité est validé par une suite de tests unitaires dédiée :

```bash
# Lancer la suite de tests du moteur de sécurité (SAST, SCA, Secrets, IaC, SARIF, SBOM)
node --import tsx --test server/security/security.test.ts

# Lancer la suite complète de tests de l'application
npm test

# Vérification du typage TypeScript
npm run typecheck
```

Résultat type de la suite de sécurité :
```text
✔ TaintAnalyzer should detect SQL injection from query parameters
✔ TaintAnalyzer should detect Command Injection
✔ SecretsScanner should detect API keys and private keys
✔ IacScanner should detect Dockerfile and Kubernetes security flaws
✔ SarifBuilder should generate valid SARIF 2.1.0 output
✔ SbomBuilder should produce CycloneDX 1.5 JSON
✔ SeverityScorer should compute realistic risk priority
✔ Should have all specialized security agent roles registered as read-only
```

---

## Structure du Dépôt

```text
leanna/
├── server/
│   ├── security/                 # ⭐ Cœur du Security OS
│   │   ├── findings/             # Modèles normalisés, Fingerprint SHA-256, CVSS/EPSS
│   │   ├── scanners/             # TaintAnalyzer (SAST), DependencyScanner (SCA), Secrets, IaC
│   │   ├── reporting/            # SarifBuilder (2.1.0), SbomBuilder (CycloneDX 1.5)
│   │   ├── orchestrator/         # SecurityOrchestrator central
│   │   └── security.test.ts      # Tests unitaires du moteur de sécurité
│   ├── agents/                   # Flotte d'agents spécialisés (rôles read-only, AgentBrain)
│   ├── knowledge/                # ASTParser, ASTCallGraph, RelationExtractor
│   ├── routes/
│   │   ├── security.ts           # Routes API REST /api/security/*
│   │   └── self-root.ts          # Résolution workspace & sandbox
│   └── utils/
│       ├── sandbox.ts            # Gestion de la sandbox isolée
│       └── crypto.ts             # Fonctions de hachage et chiffrement
├── src/                          # Frontend Security Console (React)
│   ├── components/               # UnifiedSidebar (icônes sécurité), panneaux
│   └── views/                    # ScanView, FindingsView, FindingDetailView,
│                                 # AttackSurfaceView, ReportView, RulesView, IdeView
├── electron/                     # Application Desktop
├── package.json
└── README.md
```

---

## Licence

Leanna est distribué sous licence **Business Source License 1.1 (BUSL-1.1)**. Consultez [`LICENSE`](LICENSE) pour les conditions complètes.

© 2026 Maysson — Leanna Security Operating System
