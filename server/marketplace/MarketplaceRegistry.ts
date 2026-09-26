/**
 * MarketplaceRegistry — Registre central du Marketplace Leanna.
 *
 * Gère le catalogue de paquets (agents + skills), les installations,
 * les notations communautaires, la publication et la validation de sécurité.
 *
 * En l'absence d'un backend cloud dédié, le registre s'appuie sur :
 *  - Un catalogue "communautaire" seedé en mémoire (données mockées réalistes)
 *  - La persistance locale dans `.Leanna/marketplace-registry.json`
 *  - Un moteur de validation de sécurité automatisée (analyse statique des prompts)
 */

import fs from "fs";
import path from "path";
import { createLogger } from "../utils/logger.js";
import { Leanna_APP_ROOT } from "../utils/selfRoot.js";
import type {
  MarketplacePackage,
  MarketplaceSearchParams,
  MarketplaceSearchResult,
  PublishPackageParams,
  RatePackageParams,
  SecurityReport,
  SecurityTrustLevel,
} from "./types.js";

const log = createLogger("MarketplaceRegistry");

// ─── Constantes ───────────────────────────────────────────────────────────────

const REGISTRY_FILE = "marketplace-registry.json";
const INSTALLS_FILE = "marketplace-installs.json";

// Patterns de sécurité interdits dans les prompts/instructions
const SECURITY_FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; label: string; critical: boolean }> = [
  { pattern: /ignore\s+(all\s+)?previous\s+instructions/i, label: "Prompt injection (ignore instructions)", critical: true },
  { pattern: /\beval\s*\(/i, label: "Utilisation de eval()", critical: true },
  { pattern: /process\.env\b/i, label: "Accès aux variables d'environnement", critical: true },
  { pattern: /require\s*\(\s*['"]child_process['"]\s*\)/i, label: "Import child_process", critical: true },
  { pattern: /\bexec\s*\(|execSync\s*\(/i, label: "Exécution de commandes shell", critical: true },
  { pattern: /\bpassword|secret|token|api[_\-]?key\b/i, label: "Référence à des secrets/tokens", critical: false },
  { pattern: /\bsudo\b|\brm\s+-rf\b/i, label: "Commandes destructives (sudo/rm -rf)", critical: true },
  { pattern: /fetch\s*\(\s*['"]https?:\/\/(?!api\.leanna)/i, label: "Requête HTTP externe non Leanna", critical: false },
  { pattern: /\bdrop\s+table\b|\btruncate\s+table\b/i, label: "Opérations SQL destructives", critical: true },
  { pattern: /act\s+as\s+|pretend\s+you\s+are\s+|you\s+are\s+now\s+/i, label: "Tentative de role-jailbreak", critical: false },
  { pattern: /\bbase64\b.*decode|atob\s*\(/i, label: "Décodage base64 suspect", critical: false },
];

// ═══════════════════════════════════════════════════════════════════════════════
// Données du catalogue communautaire (seed réaliste)
// ═══════════════════════════════════════════════════════════════════════════════

function buildSeedCatalog(): MarketplacePackage[] {
  const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

  return [
    // ── AGENTS ──────────────────────────────────────────────────────────────
    {
      id: "code-reviewer-pro",
      name: "Code Reviewer Pro",
      description: "Agent de revue de code approfondie avec détection de bugs, suggestions de performance et respect des bonnes pratiques.",
      readme: `# Code Reviewer Pro\n\nAgent spécialisé dans la revue de code professionnel.\n\n## Fonctionnalités\n- Détection de bugs et anti-patterns\n- Suggestions de refactoring\n- Vérification des conventions (naming, SOLID)\n- Score de qualité par fichier\n\n## Usage\nDéléguez une tâche de type "reviewer" avec les fichiers cibles.`,
      type: "agent",
      category: "code",
      tags: ["code review", "qualité", "bugs", "refactoring"],
      version: "2.1.0",
      versions: ["1.0.0", "1.5.0", "2.0.0", "2.1.0"],
      author: "leanna-labs",
      authorAvatar: "🏭",
      license: "MIT",
      avatar: "🔍",
      color: "#3b82f6",
      agent: {
        name: "Code Reviewer Pro",
        role: "code_reviewer_pro",
        description: "Revue de code approfondie avec détection de bugs et suggestions de performance",
        systemPrompt: `Tu es un expert en revue de code avec 15 ans d'expérience. Tu analyses le code fourni avec une rigueur professionnelle :
1. Identifie les bugs potentiels et les risques de sécurité
2. Suggère des optimisations de performance mesurables
3. Vérifie le respect des principes SOLID et des conventions
4. Fournit un score de qualité (0-100) avec justification
5. Propose des corrections concrètes avec exemples de code
Sois précis, bienveillant et constructif dans tes retours.`,
        capabilities: ["read_project_file", "search_in_files", "list_project_files", "read_file_outline", "reasoning_think"],
        tools: ["read_project_file", "search_in_files", "list_project_files", "read_file_outline", "reasoning_think"],
        maxConcurrency: 3,
        defaultTimeoutMs: 120_000,
        triggerKeywords: ["review", "revue", "qualité", "audit code"],
        avatar: "🔍",
        color: "#3b82f6",
        temperature: 0.3,
        maxTokens: 8192,
        model: "default",
        autoDelegate: false,
      },
      security: {
        trustLevel: "verified",
        analyzedAt: ago(5),
        score: 98,
        warnings: [],
        flags: [],
        summary: "Aucun risque détecté. Agent certifié par l'équipe Leanna.",
      },
      stats: { downloads: 4820, installs: 3210, rating: 4.8, reviewCount: 127, weeklyDownloads: 342 },
      reviews: [
        { id: "r1", author: "devpro_42", rating: 5, comment: "Indispensable ! Détecte des bugs que je n'aurais pas vu.", createdAt: ago(12), helpful: 45 },
        { id: "r2", author: "alice_dev", rating: 5, comment: "Les suggestions de refactoring sont pertinentes et bien expliquées.", createdAt: ago(28), helpful: 32 },
        { id: "r3", author: "backend_ninja", rating: 4, comment: "Très bon, parfois un peu strict sur le style.", createdAt: ago(45), helpful: 18 },
      ],
      publishedAt: ago(120),
      updatedAt: ago(5),
      featured: true,
      verified: true,
    },
    {
      id: "fullstack-architect",
      name: "Fullstack Architect",
      description: "Conçoit des architectures fullstack scalables, génère des diagrammes Mermaid et rédige les ADR (Architecture Decision Records).",
      readme: `# Fullstack Architect\n\nAgent expert en conception d'architectures logicielles modernes.\n\n## Capacités\n- Analyse de l'existant et détection de dette technique\n- Proposition d'architectures scalables (microservices, monolith modulaire)\n- Génération de diagrammes Mermaid (flowchart, séquence, ER)\n- Rédaction d'ADR standardisés\n- Évaluation des trade-offs technologiques`,
      type: "agent",
      category: "code",
      tags: ["architecture", "design", "ADR", "mermaid", "scalability"],
      version: "1.3.0",
      versions: ["1.0.0", "1.2.0", "1.3.0"],
      author: "arch_guild",
      license: "MIT",
      avatar: "🏗️",
      color: "#8b5cf6",
      agent: {
        name: "Fullstack Architect",
        role: "fullstack_architect",
        description: "Expert en conception d'architectures fullstack scalables",
        systemPrompt: `Tu es un architecte logiciel senior spécialisé dans les systèmes fullstack. Tu maîtrises les patterns modernes (Clean Architecture, DDD, CQRS) et les stacks actuelles (React, Node.js, Postgres, Redis, Docker).
Pour chaque analyse :
1. Cartographie l'architecture existante
2. Identifie les goulots d'étranglement et dettes techniques
3. Propose une architecture cible avec justifications
4. Génère des diagrammes Mermaid clairs
5. Rédige des ADR concis pour chaque décision importante`,
        capabilities: ["read_project_file", "list_project_files", "search_in_files", "read_file_outline", "reasoning_think", "write_project_file"],
        tools: ["read_project_file", "list_project_files", "search_in_files", "read_file_outline", "reasoning_think", "write_project_file"],
        maxConcurrency: 2,
        defaultTimeoutMs: 180_000,
        triggerKeywords: ["architecture", "concevoir", "scalabilité", "diagramme"],
        avatar: "🏗️",
        color: "#8b5cf6",
        temperature: 0.4,
        maxTokens: 12288,
        model: "default",
      },
      security: {
        trustLevel: "verified",
        analyzedAt: ago(10),
        score: 96,
        warnings: [],
        flags: [],
        summary: "Aucun risque détecté. Validé par l'équipe Leanna.",
      },
      stats: { downloads: 2940, installs: 1870, rating: 4.7, reviewCount: 89, weeklyDownloads: 198 },
      reviews: [
        { id: "r4", author: "techleader_fr", rating: 5, comment: "Les ADR générés sont exploitables directement. Gain de temps énorme.", createdAt: ago(20), helpful: 67 },
        { id: "r5", author: "sre_master", rating: 4, comment: "Excellent pour bootstrapper une réflexion archi. Parfois manque de profondeur sur l'infra.", createdAt: ago(35), helpful: 29 },
      ],
      publishedAt: ago(90),
      updatedAt: ago(10),
      featured: true,
      verified: true,
    },
    {
      id: "security-auditor",
      name: "Security Auditor",
      description: "Analyse le code à la recherche de vulnérabilités OWASP Top 10, injection SQL, XSS, secrets exposés et dépendances vulnérables.",
      readme: `# Security Auditor\n\nAgent de sécurité applicative basé sur l'OWASP Top 10 et les bonnes pratiques SANS.\n\n## Checks effectués\n- Injection SQL / NoSQL / LDAP\n- XSS, CSRF, clickjacking\n- Secrets et tokens hardcodés\n- Dépendances avec CVE connus\n- Validation des entrées manquante\n- Gestion incorrecte des erreurs (leak d'infos)`,
      type: "agent",
      category: "security",
      tags: ["sécurité", "OWASP", "CVE", "audit", "vulnérabilités"],
      version: "3.0.1",
      versions: ["1.0.0", "2.0.0", "2.5.0", "3.0.0", "3.0.1"],
      author: "leanna-labs",
      license: "MIT",
      avatar: "🛡️",
      color: "#ef4444",
      agent: {
        name: "Security Auditor",
        role: "security_auditor",
        description: "Audit de sécurité applicative complet basé sur OWASP Top 10",
        systemPrompt: `Tu es un expert en sécurité applicative (OWASP Top 10, SANS Top 25). Tu analyses le code avec une approche offensive (red team) pour identifier les vulnérabilités exploitables.

Pour chaque audit :
1. Scanne les injections (SQL, NoSQL, commandes shell, LDAP)
2. Détecte les XSS réfléchis, stockés et DOM-based
3. Identifie les secrets hardcodés (regex patterns)
4. Vérifie la gestion des authentifications et autorisations
5. Analyse les dépendances tierces (versions et CVE)
6. Génère un rapport structuré avec niveau de sévérité (Critical/High/Medium/Low)

Ne fournis jamais d'exploits fonctionnels. Reste dans un cadre défensif.`,
        capabilities: ["read_project_file", "search_in_files", "list_project_files", "reasoning_think"],
        tools: ["read_project_file", "search_in_files", "list_project_files", "reasoning_think"],
        maxConcurrency: 2,
        defaultTimeoutMs: 240_000,
        triggerKeywords: ["sécurité", "audit", "vulnérabilité", "OWASP", "CVE"],
        avatar: "🛡️",
        color: "#ef4444",
        temperature: 0.1,
        maxTokens: 16384,
        model: "default",
      },
      security: {
        trustLevel: "verified",
        analyzedAt: ago(3),
        score: 99,
        warnings: [],
        flags: [],
        summary: "Paquet certifié. Aucune tentative d'exfiltration ou d'injection détectée.",
      },
      stats: { downloads: 6130, installs: 4020, rating: 4.9, reviewCount: 203, weeklyDownloads: 512 },
      reviews: [
        { id: "r6", author: "ciso_pro", rating: 5, comment: "Le meilleur outil d'audit statique que j'ai testé dans un IDE. Détecte les injections SQL que Snyk rate.", createdAt: ago(8), helpful: 89 },
        { id: "r7", author: "dev_secure", rating: 5, comment: "Rapport clair avec sévérité et recommandations. Je l'utilise avant chaque PR.", createdAt: ago(22), helpful: 54 },
      ],
      publishedAt: ago(180),
      updatedAt: ago(3),
      featured: true,
      verified: true,
    },
    {
      id: "data-analyst-agent",
      name: "Data Analyst",
      description: "Agent d'analyse de données : exploration de datasets, génération de visualisations, détection d'anomalies et rapports statistiques.",
      readme: `# Data Analyst\n\nAgent spécialisé dans l'analyse et la visualisation de données.\n\n## Fonctionnalités\n- Analyse exploratoire (EDA)\n- Génération de code de visualisation (Chart.js, D3)\n- Détection d'anomalies et outliers\n- Statistiques descriptives et corrélations\n- Génération de rapports en Markdown`,
      type: "agent",
      category: "data",
      tags: ["data", "analyse", "statistiques", "visualisation", "EDA"],
      version: "1.1.0",
      versions: ["1.0.0", "1.1.0"],
      author: "data_community",
      license: "Apache-2.0",
      avatar: "📊",
      color: "#06b6d4",
      agent: {
        name: "Data Analyst",
        role: "data_analyst",
        description: "Analyse de données, visualisations et rapports statistiques",
        systemPrompt: `Tu es un data analyst expert. Tu analyses des datasets pour en extraire des insights actionnables.
Pour chaque analyse :
1. Effectue une EDA complète (shape, types, valeurs manquantes, distributions)
2. Calcule les statistiques clés (moyenne, médiane, écart-type, corrélations)
3. Identifie les anomalies et outliers avec justification statistique
4. Génère du code de visualisation (Recharts / Chart.js compatible)
5. Rédige un rapport clair en Markdown avec conclusions et recommandations`,
        capabilities: ["read_project_file", "search_in_files", "list_project_files", "reasoning_think", "write_project_file"],
        tools: ["read_project_file", "search_in_files", "reasoning_think", "write_project_file"],
        maxConcurrency: 2,
        defaultTimeoutMs: 150_000,
        triggerKeywords: ["données", "analyse", "dataset", "statistiques", "EDA"],
        avatar: "📊",
        color: "#06b6d4",
        temperature: 0.2,
        maxTokens: 8192,
        model: "default",
      },
      security: {
        trustLevel: "community",
        analyzedAt: ago(15),
        score: 88,
        warnings: ["Référence à des requêtes HTTP externes dans certains exemples du README"],
        flags: [],
        summary: "Paquet communautaire validé. Quelques mentions d'APIs externes dans la documentation.",
      },
      stats: { downloads: 1820, installs: 1150, rating: 4.5, reviewCount: 47, weeklyDownloads: 143 },
      reviews: [
        { id: "r8", author: "ml_engineer", rating: 5, comment: "Parfait pour une première exploration. Le code de visualisation est directement utilisable.", createdAt: ago(18), helpful: 28 },
        { id: "r9", author: "data_freak", rating: 4, comment: "Bon agent, manque un peu de profondeur sur les modèles ML.", createdAt: ago(40), helpful: 15 },
      ],
      publishedAt: ago(60),
      updatedAt: ago(15),
      featured: false,
      verified: true,
    },
    {
      id: "devops-pipeline-agent",
      name: "DevOps Pipeline Builder",
      description: "Génère des pipelines CI/CD pour GitHub Actions, GitLab CI et Docker Compose. Configure automatiquement les tests, builds et déploiements.",
      readme: `# DevOps Pipeline Builder\n\nAgent expert en configuration CI/CD et infrastructure as code.\n\n## Génère\n- Pipelines GitHub Actions (.github/workflows/)\n- Pipelines GitLab CI (.gitlab-ci.yml)\n- Dockerfiles optimisés multi-stage\n- Docker Compose avec services annexes\n- Scripts de déploiement Kubernetes (Helm charts basiques)`,
      type: "agent",
      category: "devops",
      tags: ["CI/CD", "Docker", "GitHub Actions", "DevOps", "pipeline"],
      version: "1.4.2",
      versions: ["1.0.0", "1.2.0", "1.4.0", "1.4.2"],
      author: "devops_collective",
      license: "MIT",
      avatar: "🚀",
      color: "#f97316",
      agent: {
        name: "DevOps Pipeline Builder",
        role: "devops_pipeline_builder",
        description: "Génération de pipelines CI/CD et configuration infrastructure",
        systemPrompt: `Tu es un expert DevOps spécialisé dans l'automatisation des pipelines CI/CD. Tu maîtrises GitHub Actions, GitLab CI, Docker et Kubernetes.
Pour chaque demande :
1. Analyse la stack technologique du projet (package.json, Dockerfile existant, etc.)
2. Génère une configuration CI/CD adaptée et optimisée
3. Inclus les étapes : lint, test, build, security scan, déploiement
4. Optimise les caches pour réduire les temps d'exécution
5. Documente chaque étape avec des commentaires clairs`,
        capabilities: ["read_project_file", "list_project_files", "write_project_file", "search_in_files"],
        tools: ["read_project_file", "list_project_files", "write_project_file", "search_in_files"],
        maxConcurrency: 2,
        defaultTimeoutMs: 90_000,
        triggerKeywords: ["CI/CD", "pipeline", "docker", "déploiement", "GitHub Actions"],
        avatar: "🚀",
        color: "#f97316",
        temperature: 0.3,
        maxTokens: 8192,
        model: "default",
      },
      security: {
        trustLevel: "community",
        analyzedAt: ago(20),
        score: 91,
        warnings: [],
        flags: [],
        summary: "Validé par la communauté. Aucune anomalie détectée.",
      },
      stats: { downloads: 3440, installs: 2210, rating: 4.6, reviewCount: 78, weeklyDownloads: 267 },
      reviews: [
        { id: "r10", author: "sre_ops", rating: 5, comment: "J'ai généré un pipeline GitHub Actions complet en 30 secondes. Bluffant.", createdAt: ago(14), helpful: 42 },
        { id: "r11", author: "cloud_dev", rating: 4, comment: "Très bon pour GitHub Actions. Le support Kubernetes est encore basique.", createdAt: ago(30), helpful: 22 },
      ],
      publishedAt: ago(75),
      updatedAt: ago(20),
      featured: false,
      verified: true,
    },
    {
      id: "doc-writer-agent",
      name: "Documentation Writer",
      description: "Rédige automatiquement la documentation technique : JSDoc, README, guides d'utilisation, changelogs et spécifications API.",
      type: "agent",
      category: "writing",
      tags: ["documentation", "JSDoc", "README", "API docs", "changelog"],
      version: "2.0.0",
      versions: ["1.0.0", "1.5.0", "2.0.0"],
      author: "leanna-labs",
      license: "MIT",
      avatar: "📝",
      color: "#10b981",
      agent: {
        name: "Documentation Writer",
        role: "doc_writer",
        description: "Rédaction automatique de documentation technique complète",
        systemPrompt: `Tu es un technical writer expert. Tu rédiges une documentation claire, complète et maintenable.
Tu génères : JSDoc/TSDoc complets, README structurés, guides d'utilisation, changelogs KEEP A CHANGELOG, specs OpenAPI.
Ton style est précis, concis et orienté utilisateur. Tu inclus toujours des exemples de code.`,
        capabilities: ["read_project_file", "list_project_files", "write_project_file", "search_in_files", "read_file_outline"],
        tools: ["read_project_file", "list_project_files", "write_project_file", "search_in_files", "read_file_outline"],
        maxConcurrency: 3,
        defaultTimeoutMs: 120_000,
        triggerKeywords: ["documentation", "JSDoc", "README", "docs", "rédiger"],
        avatar: "📝",
        color: "#10b981",
        temperature: 0.5,
        maxTokens: 8192,
        model: "default",
      },
      security: {
        trustLevel: "verified",
        analyzedAt: ago(7),
        score: 97,
        warnings: [],
        flags: [],
        summary: "Certifié Leanna Labs. Aucun risque.",
      },
      stats: { downloads: 5670, installs: 3890, rating: 4.7, reviewCount: 156, weeklyDownloads: 398 },
      reviews: [
        { id: "r12", author: "fullstack_dev", rating: 5, comment: "Le README généré est meilleur que celui que j'aurais écrit moi-même.", createdAt: ago(9), helpful: 71 },
      ],
      publishedAt: ago(100),
      updatedAt: ago(7),
      featured: true,
      verified: true,
    },
    // ── SKILLS ───────────────────────────────────────────────────────────────
    {
      id: "skill-regex-builder",
      name: "Regex Builder",
      description: "Génère, explique et teste des expressions régulières complexes à partir d'une description en langage naturel.",
      type: "skill",
      category: "code",
      tags: ["regex", "expressions régulières", "validation", "parsing"],
      version: "1.2.0",
      versions: ["1.0.0", "1.1.0", "1.2.0"],
      author: "community_dev",
      license: "MIT",
      avatar: "🔤",
      color: "#eab308",
      skills: [
        {
          name: "generate_regex",
          description: "Génère une expression régulière à partir d'une description en langage naturel avec explication et exemples de test.",
          parameters: [
            { name: "description", type: "STRING", description: "Description en langage naturel de ce que doit correspondre la regex", required: true },
            { name: "language", type: "STRING", description: "Langage cible (javascript, python, java, go)", required: false },
            { name: "examples", type: "ARRAY", description: "Exemples de chaînes qui doivent correspondre", required: false },
          ],
          instruction: `Génère une expression régulière pour : {{description}}.
Langage cible : {{language || 'javascript'}}.
Exemples à valider : {{examples || []}}.

Fournis :
1. La regex finale avec les flags appropriés
2. Une explication pas à pas de chaque groupe
3. Des exemples de correspondances (match) et non-correspondances (no-match)
4. La version pour le langage cible si différent de JS

Sois précis et explique chaque partie de la regex.`,
          category: "code",
          icon: "Code",
        },
      ],
      security: {
        trustLevel: "community",
        analyzedAt: ago(25),
        score: 94,
        warnings: [],
        flags: [],
        summary: "Skill communautaire propre. Aucune injection détectée.",
      },
      stats: { downloads: 2890, installs: 2100, rating: 4.6, reviewCount: 63, weeklyDownloads: 210 },
      reviews: [
        { id: "r13", author: "regex_hater", rating: 5, comment: "Enfin je comprends mes propres regex ! L'explication pas à pas est excellent.", createdAt: ago(16), helpful: 38 },
      ],
      publishedAt: ago(80),
      updatedAt: ago(25),
      featured: false,
      verified: false,
    },
    {
      id: "skill-sql-optimizer",
      name: "SQL Query Optimizer",
      description: "Analyse et optimise les requêtes SQL : détection des N+1, suggestions d'index, réécriture de sous-requêtes en JOIN.",
      type: "skill",
      category: "data",
      tags: ["SQL", "performance", "index", "optimisation", "requêtes"],
      version: "1.0.2",
      versions: ["1.0.0", "1.0.1", "1.0.2"],
      author: "db_experts",
      license: "MIT",
      avatar: "🗄️",
      color: "#14b8a6",
      skills: [
        {
          name: "optimize_sql_query",
          description: "Analyse une requête SQL, identifie les problèmes de performance et propose une version optimisée.",
          parameters: [
            { name: "query", type: "STRING", description: "La requête SQL à optimiser", required: true },
            { name: "schema", type: "STRING", description: "Schéma de la BDD (optionnel, CREATE TABLE statements)", required: false },
            { name: "db_type", type: "STRING", description: "Type de BDD : postgresql, mysql, sqlite", required: false },
          ],
          instruction: `Analyse cette requête SQL : {{query}}
Schéma disponible : {{schema || 'non fourni'}}.
BDD cible : {{db_type || 'postgresql'}}.

Effectue :
1. Détection des problèmes (N+1, full table scan, sous-requêtes corrélées)
2. Analyse du plan d'exécution estimé (EXPLAIN)
3. Suggestions d'index manquants avec CREATE INDEX
4. Réécriture optimisée de la requête
5. Estimation du gain de performance

Formate ta réponse avec les requêtes SQL dans des blocs de code.`,
          category: "data",
          icon: "Database",
        },
      ],
      security: {
        trustLevel: "community",
        analyzedAt: ago(30),
        score: 92,
        warnings: [],
        flags: [],
        summary: "Skill validé. Aucune opération destructive dans les instructions.",
      },
      stats: { downloads: 1650, installs: 1200, rating: 4.4, reviewCount: 38, weeklyDownloads: 125 },
      reviews: [
        { id: "r14", author: "dba_pro", rating: 4, comment: "Très utile pour détecter les index manquants. Bon support PostgreSQL.", createdAt: ago(22), helpful: 19 },
      ],
      publishedAt: ago(55),
      updatedAt: ago(30),
      featured: false,
      verified: false,
    },
    {
      id: "skill-commit-generator",
      name: "Commit Message Generator",
      description: "Génère des messages de commit conventionnels (Conventional Commits) à partir d'un diff Git ou d'une description des changements.",
      type: "skill",
      category: "code",
      tags: ["git", "commit", "conventional commits", "changelog"],
      version: "2.1.0",
      versions: ["1.0.0", "2.0.0", "2.1.0"],
      author: "git_workflows",
      license: "MIT",
      avatar: "📦",
      color: "#f59e0b",
      skills: [
        {
          name: "generate_commit_message",
          description: "Génère un message de commit Conventional Commits à partir d'un diff ou d'une description.",
          parameters: [
            { name: "diff_or_description", type: "STRING", description: "Le diff Git ou une description des changements effectués", required: true },
            { name: "scope", type: "STRING", description: "Le scope du commit (ex: auth, ui, api)", required: false },
            { name: "breaking", type: "BOOLEAN", description: "S'il s'agit d'un breaking change", required: false },
          ],
          instruction: `Génère un message de commit Conventional Commits pour ces changements : {{diff_or_description}}.
Scope suggéré : {{scope || 'auto-détecté'}}.
Breaking change : {{breaking || false}}.

Format requis :
type(scope): description courte (max 72 chars)

<corps optionnel si changement complexe>

<BREAKING CHANGE: description si applicable>

Types disponibles : feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert.
Sois précis, concis et utilise l'impératif présent en français ou en anglais selon la langue du projet.`,
          category: "code",
          icon: "Github",
        },
      ],
      security: {
        trustLevel: "verified",
        analyzedAt: ago(8),
        score: 98,
        warnings: [],
        flags: [],
        summary: "Certifié. Skill de génération de texte uniquement, sans accès au système.",
      },
      stats: { downloads: 7820, installs: 5940, rating: 4.9, reviewCount: 245, weeklyDownloads: 620 },
      reviews: [
        { id: "r15", author: "gitmaster", rating: 5, comment: "Le skill le plus utilisé de ma flotte. Les messages sont parfaits.", createdAt: ago(5), helpful: 102 },
        { id: "r16", author: "team_lead_fr", rating: 5, comment: "Toute l'équipe l'a adopté. La cohérence du changelog s'est améliorée.", createdAt: ago(15), helpful: 78 },
      ],
      publishedAt: ago(140),
      updatedAt: ago(8),
      featured: true,
      verified: true,
    },
    // ── BUNDLES ──────────────────────────────────────────────────────────────
    {
      id: "bundle-python-suite",
      name: "Python Development Suite",
      description: "Bundle complet pour le développement Python : agent expert Python + skills pytest, linting PEP8 et génération de type hints.",
      readme: `# Python Development Suite\n\nBundle tout-en-un pour les projets Python.\n\n## Inclus\n- **Agent** : Python Expert (FastAPI, Django, pandas, async)\n- **Skill** : run_pytest — exécution et analyse des tests\n- **Skill** : check_pep8 — analyse de style PEP8\n- **Skill** : add_type_hints — ajout de type hints sur du code existant`,
      type: "bundle",
      category: "code",
      tags: ["Python", "pytest", "PEP8", "type hints", "FastAPI", "bundle"],
      version: "1.2.0",
      versions: ["1.0.0", "1.1.0", "1.2.0"],
      author: "python_guild",
      license: "MIT",
      avatar: "🐍",
      color: "#3b82f6",
      agent: {
        name: "Python Expert",
        role: "python_expert",
        description: "Expert Python : FastAPI, Django, pandas, asyncio, optimisation",
        systemPrompt: `Tu es un expert Python avec 10+ ans d'expérience. Tu maîtrises FastAPI, Django, Flask, pandas, SQLAlchemy, asyncio, pytest, mypy et les bonnes pratiques PEP8/PEP484.
Tu produis du code Python propre, typé, testé et documenté. Tu expliques tes choix techniques.`,
        capabilities: ["read_project_file", "write_project_file", "search_in_files", "list_project_files", "reasoning_think", "system_execute_command"],
        tools: ["read_project_file", "write_project_file", "search_in_files", "list_project_files", "reasoning_think"],
        maxConcurrency: 2,
        defaultTimeoutMs: 120_000,
        triggerKeywords: ["python", "pytest", "django", "fastapi", "pandas"],
        avatar: "🐍",
        color: "#3b82f6",
        temperature: 0.3,
        model: "default",
      },
      skills: [
        {
          name: "run_pytest_analysis",
          description: "Lance les tests pytest et analyse les résultats pour identifier les échecs et suggérer des corrections.",
          parameters: [
            { name: "test_path", type: "STRING", description: "Chemin vers les tests (ex: tests/ ou tests/test_api.py)", required: false },
          ],
          instruction: "Analyse les tests pytest dans {{test_path || 'tests/'}}. Identifie les échecs, leurs causes probables et propose des corrections.",
          category: "code",
          icon: "Code",
        },
        {
          name: "check_python_style",
          description: "Vérifie la conformité PEP8 et PEP484 du code Python avec suggestions de correction.",
          parameters: [
            { name: "file_path", type: "STRING", description: "Fichier Python à analyser", required: true },
          ],
          instruction: "Analyse le fichier Python {{file_path}} pour la conformité PEP8 (style) et PEP484 (type hints). Liste les problèmes avec leur ligne et propose les corrections.",
          category: "code",
          icon: "Code",
        },
      ],
      security: {
        trustLevel: "community",
        analyzedAt: ago(18),
        score: 87,
        warnings: ["Le skill run_pytest_analysis fait référence à l'exécution de commandes — exécution réelle gérée par le runtime Leanna uniquement."],
        flags: [],
        summary: "Bundle communautaire. Les skills de lancement de tests sont surveillés par le runtime Leanna.",
      },
      stats: { downloads: 2230, installs: 1480, rating: 4.5, reviewCount: 56, weeklyDownloads: 178 },
      reviews: [
        { id: "r17", author: "pythonista_fr", rating: 5, comment: "L'agent Python + les skills forment un combo redoutable.", createdAt: ago(12), helpful: 31 },
        { id: "r18", author: "fastapi_dev", rating: 4, comment: "Très bon pour FastAPI. L'ajout de type hints est magique.", createdAt: ago(28), helpful: 20 },
      ],
      publishedAt: ago(70),
      updatedAt: ago(18),
      featured: false,
      verified: false,
    },
  ];
}

// ═══════════════════════════════════════════════════════════════════════════════
// Moteur de validation de sécurité
// ═══════════════════════════════════════════════════════════════════════════════

export function runSecurityAnalysis(pkg: PublishPackageParams): SecurityReport {
  const warnings: string[] = [];
  const flags: string[] = [];

  // Textes à analyser
  const textsToScan: string[] = [
    pkg.agent?.systemPrompt ?? "",
    pkg.agent?.description ?? "",
    ...(pkg.skills ?? []).map((s) => s.instruction),
    ...(pkg.skills ?? []).map((s) => s.description),
    pkg.description,
    pkg.readme ?? "",
  ];

  for (const text of textsToScan) {
    if (!text) continue;
    for (const { pattern, label, critical } of SECURITY_FORBIDDEN_PATTERNS) {
      if (pattern.test(text)) {
        if (critical) {
          flags.push(label);
        } else {
          if (!warnings.includes(label)) warnings.push(label);
        }
      }
    }
  }

  // Score de base
  let score = 100;
  score -= flags.length * 15;
  score -= warnings.length * 5;
  score = Math.max(0, Math.min(100, score));

  // Niveau de confiance
  let trustLevel: SecurityTrustLevel;
  if (flags.length > 0) {
    trustLevel = "flagged";
  } else if (score >= 90) {
    trustLevel = "community";
  } else {
    trustLevel = "unreviewed";
  }

  const summary =
    flags.length > 0
      ? `⚠️ ${flags.length} problème(s) critique(s) détecté(s) : ${flags.join(", ")}. Publication bloquée.`
      : warnings.length > 0
      ? `Validé avec ${warnings.length} avertissement(s) : ${warnings.join(", ")}.`
      : "Aucun problème détecté. Paquet approuvé pour publication.";

  return {
    trustLevel,
    analyzedAt: new Date().toISOString(),
    score,
    warnings,
    flags,
    summary,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Classe principale
// ═══════════════════════════════════════════════════════════════════════════════

export class MarketplaceRegistry {
  private packages: Map<string, MarketplacePackage> = new Map();
  private installedPackageIds: Set<string> = new Set();
  private static instance: MarketplaceRegistry;

  private constructor() {
    this._loadCatalog();
    this._loadInstalls();
  }

  public static getInstance(): MarketplaceRegistry {
    if (!MarketplaceRegistry.instance) {
      MarketplaceRegistry.instance = new MarketplaceRegistry();
    }
    return MarketplaceRegistry.instance;
  }

  // ── Persistance ─────────────────────────────────────────────────────────────

  private _getRegistryPath(): string {
    return path.join(Leanna_APP_ROOT, REGISTRY_FILE);
  }

  private _getInstallsPath(): string {
    return path.join(Leanna_APP_ROOT, INSTALLS_FILE);
  }

  private _loadCatalog(): void {
    // Seed avec le catalogue communautaire
    const seed = buildSeedCatalog();
    for (const pkg of seed) {
      this.packages.set(pkg.id, pkg);
    }

    // Charger les paquets publiés localement (utilisateur)
    const filePath = this._getRegistryPath();
    if (fs.existsSync(filePath)) {
      try {
        const raw = fs.readFileSync(filePath, "utf-8");
        const localPackages: MarketplacePackage[] = JSON.parse(raw);
        for (const pkg of localPackages) {
          if (pkg?.id) this.packages.set(pkg.id, pkg);
        }
        log.info(`📦 ${localPackages.length} paquet(s) local/locaux chargé(s) depuis ${REGISTRY_FILE}`);
      } catch (e: any) {
        log.warn(`Impossible de charger ${REGISTRY_FILE}: ${e.message}`);
      }
    }

    log.info(`✅ Registre Marketplace initialisé: ${this.packages.size} paquet(s) au total`);
  }

  private _saveCatalog(): void {
    // Sauvegarder uniquement les paquets publiés localement (non seedés)
    const seedIds = new Set(buildSeedCatalog().map((p) => p.id));
    const localPackages = Array.from(this.packages.values()).filter(
      (p) => !seedIds.has(p.id)
    );
    try {
      fs.mkdirSync(Leanna_APP_ROOT, { recursive: true });
      fs.writeFileSync(this._getRegistryPath(), JSON.stringify(localPackages, null, 2), "utf-8");
    } catch (e: any) {
      log.error(`Erreur sauvegarde registre: ${e.message}`);
    }
  }

  private _loadInstalls(): void {
    const filePath = this._getInstallsPath();
    if (!fs.existsSync(filePath)) return;
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      const ids: string[] = JSON.parse(raw);
      this.installedPackageIds = new Set(ids);
    } catch {
      // silencieux
    }
  }

  private _saveInstalls(): void {
    try {
      fs.mkdirSync(Leanna_APP_ROOT, { recursive: true });
      fs.writeFileSync(
        this._getInstallsPath(),
        JSON.stringify(Array.from(this.installedPackageIds), null, 2),
        "utf-8"
      );
    } catch (e: any) {
      log.error(`Erreur sauvegarde installs: ${e.message}`);
    }
  }

  // ── API publique ─────────────────────────────────────────────────────────────

  /** Recherche dans le catalogue avec filtres et pagination */
  search(params: MarketplaceSearchParams): MarketplaceSearchResult {
    let results = Array.from(this.packages.values());

    // Filtre par query (nom, description, tags, auteur)
    if (params.query?.trim()) {
      const q = params.query.trim().toLowerCase();
      results = results.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          p.tags.some((t) => t.toLowerCase().includes(q)) ||
          p.author.toLowerCase().includes(q)
      );
    }

    // Filtres stricts
    if (params.type) results = results.filter((p) => p.type === params.type);
    if (params.category) results = results.filter((p) => p.category === params.category);
    if (params.verified !== undefined) results = results.filter((p) => p.verified === params.verified);
    if (params.featured !== undefined) results = results.filter((p) => p.featured === params.featured);
    if (params.tags?.length) {
      results = results.filter((p) => params.tags!.some((t) => p.tags.includes(t)));
    }

    // Tri
    switch (params.sort) {
      case "rating":
        results.sort((a, b) => b.stats.rating - a.stats.rating);
        break;
      case "installs":
        results.sort((a, b) => b.stats.installs - a.stats.installs);
        break;
      case "recent":
        results.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        break;
      case "popular":
      default:
        results.sort((a, b) => b.stats.downloads - a.stats.downloads);
        break;
    }

    const total = results.length;
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const start = (page - 1) * limit;
    const paged = results.slice(start, start + limit);

    // Enrichir avec l'état d'installation
    const enriched = paged.map((p) => ({
      ...p,
      _installed: this.installedPackageIds.has(p.id),
    }));

    return {
      packages: enriched as MarketplacePackage[],
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  /** Récupère un paquet par ID */
  getPackage(id: string): (MarketplacePackage & { _installed?: boolean }) | undefined {
    const pkg = this.packages.get(id);
    if (!pkg) return undefined;
    return { ...pkg, _installed: this.installedPackageIds.has(id) };
  }

  /** Vérifie si un paquet est installé */
  isInstalled(id: string): boolean {
    return this.installedPackageIds.has(id);
  }

  /** Marque un paquet comme installé */
  markInstalled(id: string): void {
    this.installedPackageIds.add(id);
    // Incrémenter les stats
    const pkg = this.packages.get(id);
    if (pkg) {
      pkg.stats.installs += 1;
      pkg.stats.downloads += 1;
      this.packages.set(id, pkg);
    }
    this._saveInstalls();
  }

  /** Marque un paquet comme désinstallé */
  markUninstalled(id: string): void {
    this.installedPackageIds.delete(id);
    this._saveInstalls();
  }

  /** Publie un nouveau paquet dans le registre local */
  publish(params: PublishPackageParams): { success: boolean; package?: MarketplacePackage; error?: string; securityReport: SecurityReport } {
    // Validation sécurité
    const security = runSecurityAnalysis(params);

    if (security.trustLevel === "flagged") {
      return {
        success: false,
        error: `Publication bloquée pour raison de sécurité : ${security.summary}`,
        securityReport: security,
      };
    }

    // Générer un ID unique basé sur le nom (slug)
    const baseId = params.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const id = this.packages.has(baseId) ? `${baseId}-${Date.now()}` : baseId;

    const now = new Date().toISOString();
    const pkg: MarketplacePackage = {
      id,
      name: params.name,
      description: params.description,
      readme: params.readme,
      type: params.type,
      category: params.category,
      tags: params.tags,
      version: params.version,
      versions: [params.version],
      author: params.author,
      license: params.license,
      repositoryUrl: params.repositoryUrl,
      avatar: params.avatar,
      color: params.color,
      agent: params.agent as any,
      skills: params.skills as any,
      security,
      stats: { downloads: 0, installs: 0, rating: 0, reviewCount: 0, weeklyDownloads: 0 },
      reviews: [],
      publishedAt: now,
      updatedAt: now,
      featured: false,
      verified: false,
    };

    this.packages.set(id, pkg);
    this._saveCatalog();

    log.info(`📤 Paquet "${id}" publié par ${params.author} (score sécurité: ${security.score})`);

    return { success: true, package: pkg, securityReport: security };
  }

  /** Ajoute une note/avis sur un paquet */
  ratePackage(params: RatePackageParams): { success: boolean; error?: string } {
    const pkg = this.packages.get(params.packageId);
    if (!pkg) return { success: false, error: "Paquet introuvable" };

    const review = {
      id: `review-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      author: params.author,
      rating: params.rating,
      comment: params.comment ?? "",
      createdAt: new Date().toISOString(),
      helpful: 0,
    };

    pkg.reviews.unshift(review);

    // Recalculer la moyenne
    const totalRating = pkg.reviews.reduce((sum, r) => sum + r.rating, 0);
    pkg.stats.rating = Math.round((totalRating / pkg.reviews.length) * 10) / 10;
    pkg.stats.reviewCount = pkg.reviews.length;
    pkg.updatedAt = new Date().toISOString();

    this.packages.set(params.packageId, pkg);
    this._saveCatalog();

    log.info(`⭐ Avis ajouté sur "${params.packageId}" par ${params.author} (${params.rating}/5)`);
    return { success: true };
  }

  /** Récupère les paquets mis en avant */
  getFeatured(): MarketplacePackage[] {
    return Array.from(this.packages.values())
      .filter((p) => p.featured)
      .sort((a, b) => b.stats.downloads - a.stats.downloads);
  }

  /** Récupère les paquets installés */
  getInstalled(): (MarketplacePackage & { _installed: true })[] {
    return Array.from(this.packages.values())
      .filter((p) => this.installedPackageIds.has(p.id))
      .map((p) => ({ ...p, _installed: true as const }));
  }

  /** Stats globales du Marketplace */
  getStats() {
    const all = Array.from(this.packages.values());
    return {
      total: all.length,
      agents: all.filter((p) => p.type === "agent").length,
      skills: all.filter((p) => p.type === "skill").length,
      bundles: all.filter((p) => p.type === "bundle").length,
      verified: all.filter((p) => p.verified).length,
      totalInstalls: all.reduce((s, p) => s + p.stats.installs, 0),
      installed: this.installedPackageIds.size,
    };
  }
}

export const marketplaceRegistry = MarketplaceRegistry.getInstance();
