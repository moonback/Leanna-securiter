/**
 * OWASP Top 10 (2021) — Rule Pack
 *
 * Couvre les 10 catégories de risques OWASP Top 10 2021 :
 * A01 — Broken Access Control
 * A02 — Cryptographic Failures
 * A03 — Injection
 * A04 — Insecure Design
 * A05 — Security Misconfiguration
 * A06 — Vulnerable and Outdated Components
 * A07 — Identification and Authentication Failures
 * A08 — Software and Data Integrity Failures
 * A09 — Security Logging and Monitoring Failures
 * A10 — Server-Side Request Forgery (SSRF)
 */

import type { Rule } from "../Rule.js";

export const owaspTop10Rules: Rule[] = [
  // ─── A01 — Broken Access Control ────────────────────────────────────────────
  {
    id: "OWASP-A01-MISSING-AUTHZ",
    name: "Missing Authorization Check",
    description:
      "Route ou endpoint qui ne vérifie pas les droits d'accès de l'utilisateur avant d'exposer des ressources sensibles.",
    family: "sast",
    severity: "high",
    cwe: "CWE-862",
    owasp: "A01:2021",
    enabled: true,
    tags: ["access-control", "authorization", "owasp-a01"],
    references: [
      "https://owasp.org/Top10/A01_2021-Broken_Access_Control/",
      "https://cwe.mitre.org/data/definitions/862.html",
    ],
    remediation:
      "Implémenter un middleware d'autorisation sur toutes les routes sensibles. Appliquer le principe du moindre privilège.",
    confidence: 0.6,
    patterns: [
      {
        regex: "app\\.(get|post|put|delete|patch)\\s*\\(['\"`][^'\"`)]+['\"`]",
        regexFlags: "gm",
        extensions: [".ts", ".js", ".mjs"],
        excludePaths: ["test", "spec", ".test.", ".spec."],
      },
    ],
  },

  // ─── A02 — Cryptographic Failures ──────────────────────────────────────────
  {
    id: "OWASP-A02-WEAK-HASH",
    name: "Weak Cryptographic Hash (MD5/SHA1)",
    description: "Utilisation de MD5 ou SHA-1, des algorithmes de hachage cryptographiquement cassés.",
    family: "sast",
    severity: "high",
    cwe: "CWE-327",
    owasp: "A02:2021",
    enabled: true,
    tags: ["cryptography", "hash", "owasp-a02"],
    references: [
      "https://owasp.org/Top10/A02_2021-Cryptographic_Failures/",
      "https://cwe.mitre.org/data/definitions/327.html",
    ],
    remediation:
      "Remplacer MD5/SHA-1 par SHA-256 ou bcrypt/argon2 (pour les mots de passe).",
    confidence: 0.9,
    patterns: [
      {
        regex: "createHash\\(['\"](?:md5|sha1)['\"]\\)",
        regexFlags: "gi",
        extensions: [".ts", ".js", ".mjs", ".py"],
      },
      {
        regex: "hashlib\\.(?:md5|sha1)\\(",
        regexFlags: "gi",
        extensions: [".py"],
      },
    ],
  },
  {
    id: "OWASP-A02-HARDCODED-SECRET",
    name: "Hardcoded Cryptographic Secret",
    description: "Secret cryptographique codé en dur dans le code source.",
    family: "secrets",
    severity: "critical",
    cwe: "CWE-321",
    owasp: "A02:2021",
    enabled: true,
    tags: ["cryptography", "secrets", "owasp-a02"],
    references: [
      "https://owasp.org/Top10/A02_2021-Cryptographic_Failures/",
      "https://cwe.mitre.org/data/definitions/321.html",
    ],
    remediation: "Utiliser des variables d'environnement ou un gestionnaire de secrets (Vault, AWS Secrets Manager).",
    confidence: 0.85,
    patterns: [
      {
        regex: "(?:secret|password|passwd|pwd|api_key|apikey|private_key)\\s*[=:]\\s*['\"][^'\"]{8,}['\"]",
        regexFlags: "gi",
        excludePaths: [".env.example", ".env.sample", "test", "spec", "mock"],
      },
    ],
  },

  // ─── A03 — Injection ────────────────────────────────────────────────────────
  {
    id: "OWASP-A03-SQL-INJECTION",
    name: "SQL Injection — String Concatenation",
    description:
      "Construction d'une requête SQL par concaténation de chaîne avec des données utilisateur non validées.",
    family: "sast",
    severity: "critical",
    cwe: "CWE-89",
    owasp: "A03:2021",
    enabled: true,
    tags: ["injection", "sql", "owasp-a03"],
    references: [
      "https://owasp.org/Top10/A03_2021-Injection/",
      "https://cwe.mitre.org/data/definitions/89.html",
    ],
    remediation:
      "Utiliser des requêtes paramétrées (prepared statements) ou un ORM qui gère l'échappement.",
    confidence: 0.8,
    patterns: [
      {
        regex: "(?:SELECT|INSERT|UPDATE|DELETE|DROP|CREATE).*\\+\\s*(?:req\\.|request\\.|params\\.|query\\.|body\\.)",
        regexFlags: "gi",
        extensions: [".ts", ".js", ".mjs", ".py", ".php"],
      },
      {
        regex: "`.*(?:SELECT|INSERT|UPDATE|DELETE).*\\$\\{[^}]+\\}",
        regexFlags: "gi",
        extensions: [".ts", ".js", ".mjs"],
      },
    ],
  },
  {
    id: "OWASP-A03-COMMAND-INJECTION",
    name: "Command Injection",
    description: "Exécution de commandes système avec des données utilisateur non validées.",
    family: "sast",
    severity: "critical",
    cwe: "CWE-78",
    owasp: "A03:2021",
    enabled: true,
    tags: ["injection", "command", "owasp-a03"],
    references: [
      "https://owasp.org/Top10/A03_2021-Injection/",
      "https://cwe.mitre.org/data/definitions/78.html",
    ],
    remediation:
      "Valider et assainir toutes les entrées. Préférer les APIs système plutôt que exec/shell. Utiliser des listes blanches de commandes.",
    confidence: 0.85,
    patterns: [
      {
        regex: "(?:exec|execSync|spawn|spawnSync|system|shell_exec|popen)\\s*\\([^)]*(?:req\\.|request\\.|params\\.|query\\.|body\\.)",
        regexFlags: "gi",
        extensions: [".ts", ".js", ".mjs", ".py", ".php"],
      },
    ],
  },
  {
    id: "OWASP-A03-XSS",
    name: "Cross-Site Scripting (XSS) — Reflected",
    description: "Données utilisateur reflétées dans une réponse HTML sans encodage approprié.",
    family: "sast",
    severity: "high",
    cwe: "CWE-79",
    owasp: "A03:2021",
    enabled: true,
    tags: ["injection", "xss", "owasp-a03"],
    references: [
      "https://owasp.org/Top10/A03_2021-Injection/",
      "https://cwe.mitre.org/data/definitions/79.html",
    ],
    remediation:
      "Encoder toutes les sorties HTML. Utiliser une Content Security Policy (CSP) stricte. Éviter innerHTML avec des données dynamiques.",
    confidence: 0.75,
    patterns: [
      {
        regex: "innerHTML\\s*=\\s*(?!`<|\"<|'<)",
        regexFlags: "gm",
        extensions: [".ts", ".tsx", ".js", ".jsx"],
      },
      {
        regex: "dangerouslySetInnerHTML",
        regexFlags: "gm",
        extensions: [".tsx", ".jsx"],
      },
      {
        regex: "res\\.send\\s*\\([^)]*(?:req\\.|request\\.|params\\.|query\\.)",
        regexFlags: "gm",
        extensions: [".ts", ".js"],
      },
    ],
  },

  // ─── A05 — Security Misconfiguration ───────────────────────────────────────
  {
    id: "OWASP-A05-DEBUG-ENABLED",
    name: "Debug Mode Enabled in Production",
    description: "Mode debug ou développement activé explicitement, pouvant exposer des informations sensibles.",
    family: "iac",
    severity: "medium",
    cwe: "CWE-94",
    owasp: "A05:2021",
    enabled: true,
    tags: ["misconfiguration", "debug", "owasp-a05"],
    references: ["https://owasp.org/Top10/A05_2021-Security_Misconfiguration/"],
    remediation: "Désactiver le mode debug en production. Utiliser des variables d'environnement pour contrôler le comportement.",
    confidence: 0.7,
    patterns: [
      {
        regex: "DEBUG\\s*=\\s*[\"']?true[\"']?",
        regexFlags: "gim",
        extensions: [".env", ".json", ".yaml", ".yml"],
      },
    ],
  },

  // ─── A07 — Authentication Failures ─────────────────────────────────────────
  {
    id: "OWASP-A07-WEAK-JWT",
    name: "JWT with Weak/None Algorithm",
    description: "Utilisation de l'algorithme 'none' ou d'un algorithme faible pour les tokens JWT.",
    family: "sast",
    severity: "critical",
    cwe: "CWE-347",
    owasp: "A07:2021",
    enabled: true,
    tags: ["authentication", "jwt", "owasp-a07"],
    references: [
      "https://owasp.org/Top10/A07_2021-Identification_and_Authentication_Failures/",
      "https://cwe.mitre.org/data/definitions/347.html",
    ],
    remediation:
      "Utiliser RS256 ou ES256 avec des clés asymétriques. Ne jamais accepter l'algorithme 'none'. Valider la signature côté serveur.",
    confidence: 0.9,
    patterns: [
      {
        regex: "algorithm['\"]?\\s*:\\s*['\"]none['\"]",
        regexFlags: "gi",
        extensions: [".ts", ".js", ".mjs"],
      },
      {
        regex: "jwt\\.sign\\s*\\([^,]+,[^,]+,\\s*\\{[^}]*algorithm:\\s*['\"]HS256['\"]",
        regexFlags: "gi",
        extensions: [".ts", ".js"],
      },
    ],
  },

  // ─── A10 — SSRF ─────────────────────────────────────────────────────────────
  {
    id: "OWASP-A10-SSRF",
    name: "Server-Side Request Forgery (SSRF)",
    description:
      "Requêtes HTTP côté serveur construites avec des données utilisateur non validées, permettant une redirection vers des ressources internes.",
    family: "sast",
    severity: "high",
    cwe: "CWE-918",
    owasp: "A10:2021",
    enabled: true,
    tags: ["ssrf", "owasp-a10"],
    references: [
      "https://owasp.org/Top10/A10_2021-Server-Side_Request_Forgery_%28SSRF%29/",
      "https://cwe.mitre.org/data/definitions/918.html",
    ],
    remediation:
      "Valider et filtrer les URLs côté serveur. Utiliser des listes blanches de domaines autorisés. Bloquer les accès aux plages IP privées (169.254.x.x, 10.x, 172.16-31.x, 192.168.x).",
    confidence: 0.75,
    patterns: [
      {
        regex: "fetch\\s*\\([^)]*(?:req\\.|request\\.|params\\.|query\\.|body\\.)",
        regexFlags: "gm",
        extensions: [".ts", ".js", ".mjs"],
      },
      {
        regex: "axios\\s*\\.(?:get|post|put|delete)\\s*\\([^)]*(?:req\\.|request\\.|params\\.)",
        regexFlags: "gm",
        extensions: [".ts", ".js"],
      },
    ],
  },
];
