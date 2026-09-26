/**
 * CISA KEV (Known Exploited Vulnerabilities) — Rule Pack
 *
 * Règles de détection basées sur les dépendances connues comme activement exploitées
 * selon le catalogue KEV de la CISA (Cybersecurity and Infrastructure Security Agency).
 * https://www.cisa.gov/known-exploited-vulnerabilities-catalog
 *
 * Ces règles ciblent les patterns d'utilisation de bibliothèques vulnérables connues,
 * et sont mises à jour régulièrement.
 */

import type { Rule } from "../Rule.js";

export const cisaKevRules: Rule[] = [
  {
    id: "CISA-KEV-LOG4SHELL",
    name: "Log4Shell (CVE-2021-44228) — Log4j Usage",
    description:
      "Utilisation de Log4j dans une version vulnérable à Log4Shell (CVE-2021-44228), une vulnérabilité RCE critique activement exploitée.",
    family: "sca",
    severity: "critical",
    cwe: "CWE-917",
    enabled: true,
    tags: ["log4j", "rce", "log4shell", "cisa-kev", "java"],
    references: [
      "https://www.cisa.gov/uscert/ncas/alerts/aa21-356a",
      "https://nvd.nist.gov/vuln/detail/CVE-2021-44228",
    ],
    remediation:
      "Mettre à jour Log4j vers 2.17.1+ (Java 8), 2.12.4+ (Java 7), ou 2.3.2+ (Java 6). Appliquer la mitigation LOG4J_FORMAT_MSG_NO_LOOKUPS=true si la mise à jour est impossible.",
    confidence: 0.95,
    patterns: [
      {
        regex: "log4j[:\\/]log4j[:\\/](?:[0-9.]+)",
        regexFlags: "gi",
        extensions: [".xml", ".gradle", ".txt"],
      },
      {
        regex: "\"log4j\"\\s*:\\s*\"(?:1\\.|2\\.[0-9]\\.|2\\.1[0-6]\\.)",
        regexFlags: "gi",
        extensions: [".json"],
      },
    ],
  },
  {
    id: "CISA-KEV-SPRING4SHELL",
    name: "Spring4Shell (CVE-2022-22965) — Spring Framework",
    description:
      "Utilisation de Spring Framework 5.3.x < 5.3.18 ou 5.2.x < 5.2.20 vulnérable à Spring4Shell.",
    family: "sca",
    severity: "critical",
    cwe: "CWE-94",
    enabled: true,
    tags: ["spring", "rce", "spring4shell", "cisa-kev", "java"],
    references: [
      "https://spring.io/blog/2022/03/31/spring-framework-rce-early-announcement",
      "https://nvd.nist.gov/vuln/detail/CVE-2022-22965",
    ],
    remediation: "Mettre à jour Spring Framework vers 5.3.18+ ou 5.2.20+.",
    confidence: 0.8,
    patterns: [
      {
        regex: "spring-webmvc[:\\/](?:5\\.[0-2]\\.|5\\.3\\.(?:[0-9]|1[0-7])\\b)",
        regexFlags: "gi",
        extensions: [".xml", ".gradle", ".txt"],
      },
    ],
  },
  {
    id: "CISA-KEV-SHELLSHOCK",
    name: "Shellshock — Bash Environment Variable Injection",
    description:
      "Pattern d'appel Bash avec des variables d'environnement non filtrées pouvant déclencher Shellshock (CVE-2014-6271).",
    family: "sast",
    severity: "critical",
    cwe: "CWE-78",
    enabled: true,
    tags: ["bash", "shellshock", "cisa-kev", "command-injection"],
    references: [
      "https://nvd.nist.gov/vuln/detail/CVE-2014-6271",
    ],
    remediation: "Mettre à jour Bash. Ne jamais passer des données utilisateur comme variables d'environnement à un sous-processus.",
    confidence: 0.7,
    patterns: [
      {
        regex: "\\(\\s*\\)\\s*\\{[^}]*\\}\\s*;",
        regexFlags: "gm",
      },
    ],
  },
  {
    id: "CISA-KEV-NPM-LODASH-PROTOTYPE",
    name: "Lodash Prototype Pollution (CVE-2019-10744)",
    description:
      "Utilisation de lodash < 4.17.12 vulnérable à la pollution de prototype, activement exploitée.",
    family: "sca",
    severity: "high",
    cwe: "CWE-1321",
    enabled: true,
    tags: ["lodash", "prototype-pollution", "npm", "cisa-kev"],
    references: [
      "https://nvd.nist.gov/vuln/detail/CVE-2019-10744",
      "https://snyk.io/vuln/SNYK-JS-LODASH-567746",
    ],
    remediation: "Mettre à jour lodash vers 4.17.21+.",
    confidence: 0.9,
    patterns: [
      {
        regex: "\"lodash\"\\s*:\\s*\"[<~^]?(?:[0-3]\\.|4\\.(?:[0-9]\\.|1[0-6]\\.))",
        regexFlags: "gi",
        extensions: [".json"],
      },
    ],
  },
  {
    id: "CISA-KEV-NPM-HANDLEBARS",
    name: "Handlebars RCE (CVE-2019-19919)",
    description:
      "Utilisation de handlebars < 4.7.3 vulnérable à l'exécution de code à distance via des templates non fiables.",
    family: "sca",
    severity: "critical",
    cwe: "CWE-94",
    enabled: true,
    tags: ["handlebars", "rce", "template-injection", "npm", "cisa-kev"],
    references: [
      "https://nvd.nist.gov/vuln/detail/CVE-2019-19919",
    ],
    remediation: "Mettre à jour handlebars vers 4.7.3+. Ne jamais compiler des templates provenant d'utilisateurs.",
    confidence: 0.9,
    patterns: [
      {
        regex: "\"handlebars\"\\s*:\\s*\"[<~^]?(?:[0-3]\\.|4\\.[0-6]\\.|4\\.7\\.[0-2]\\b)",
        regexFlags: "gi",
        extensions: [".json"],
      },
    ],
  },
  {
    id: "CISA-KEV-XMLRPC",
    name: "XML-RPC Amplification Attack Pattern",
    description:
      "Exposition d'un endpoint XML-RPC sans protection, utilisé pour des attaques par amplification (CVE-2013-0235).",
    family: "sast",
    severity: "high",
    cwe: "CWE-400",
    enabled: true,
    tags: ["xmlrpc", "amplification", "cisa-kev"],
    references: [
      "https://nvd.nist.gov/vuln/detail/CVE-2013-0235",
    ],
    remediation: "Désactiver XML-RPC si non utilisé. Implémenter une limitation de débit.",
    confidence: 0.7,
    patterns: [
      {
        regex: "xmlrpc|xml-rpc|XMLRPC",
        regexFlags: "gi",
        extensions: [".ts", ".js", ".py", ".php"],
      },
    ],
  },
  {
    id: "CISA-KEV-PROXYLOGON",
    name: "ProxyLogon Pattern — Exchange-Like SSRF Chain",
    description:
      "Pattern de code similaire aux vulnérabilités ProxyLogon (CVE-2021-26855) : SSRF côté serveur suivi d'une désérialisation.",
    family: "sast",
    severity: "critical",
    cwe: "CWE-918",
    enabled: true,
    tags: ["ssrf", "proxylogon", "cisa-kev"],
    references: [
      "https://nvd.nist.gov/vuln/detail/CVE-2021-26855",
      "https://msrc.microsoft.com/update-guide/vulnerability/CVE-2021-26855",
    ],
    remediation: "Filtrer toutes les requêtes HTTP sortantes. Valider les URLs contre une liste blanche.",
    confidence: 0.5,
    patterns: [],
  },
];
