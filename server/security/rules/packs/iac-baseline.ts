/**
 * IaC Baseline — Rule Pack
 *
 * Règles de configuration d'infrastructure (Docker / Kubernetes / Terraform).
 * Les identifiants (`id`) correspondent aux `ruleId` émis par `IacScanner`, ce qui
 * permet au RuleEngine d'associer un finding IaC au pack qui le revendique et donc
 * de le filtrer lorsque le pack est désactivé.
 *
 * Référentiels : CIS Docker Benchmark, CIS Kubernetes Benchmark, AWS Foundational
 * Security Best Practices.
 */

import type { Rule } from "../Rule.js";

export const iacBaselineRules: Rule[] = [
  // ─── Docker ────────────────────────────────────────────────────────────────
  {
    id: "IAC-DOCKER-ROOT",
    name: "Conteneur exécuté en tant que root",
    description:
      "Le Dockerfile ne déclare aucune directive USER non-privilégiée ; le conteneur s'exécute donc en root par défaut.",
    family: "iac",
    severity: "high",
    cwe: "CWE-250",
    owasp: "A05:2021",
    enabled: true,
    tags: ["docker", "container", "least-privilege", "cis-docker"],
    references: [
      "https://cwe.mitre.org/data/definitions/250.html",
      "https://owasp.org/Top10/A05_2021-Security_Misconfiguration/",
    ],
    remediation:
      "Ajouter un utilisateur système sans privilèges : RUN adduser -D appuser && USER appuser.",
    confidence: 0.7,
    patterns: [],
  },
  {
    id: "IAC-DOCKER-LATEST",
    name: "Image de base Docker non épinglée (tag latest)",
    description:
      "Une instruction FROM utilise le tag latest ou une image sans version/digest exact, rendant les builds non reproductibles.",
    family: "iac",
    severity: "medium",
    cwe: "CWE-1104",
    owasp: "A06:2021",
    enabled: true,
    tags: ["docker", "supply-chain", "reproducibility", "cis-docker"],
    references: [
      "https://cwe.mitre.org/data/definitions/1104.html",
      "https://owasp.org/Top10/A06_2021-Vulnerable_and_Outdated_Components/",
    ],
    remediation:
      "Épingler une version exacte ou un digest SHA-256 (ex: FROM node:20.11-alpine@sha256:...).",
    confidence: 0.8,
    patterns: [],
  },

  // ─── Kubernetes ──────────────────────────────────────────────────────────────
  {
    id: "IAC-K8S-PRIVILEGED",
    name: "Conteneur Kubernetes en mode privilégié",
    description:
      "Un conteneur est déployé avec securityContext.privileged: true, ce qui équivaut à un accès root complet sur le nœud hôte.",
    family: "iac",
    severity: "critical",
    cwe: "CWE-250",
    owasp: "A05:2021",
    enabled: true,
    tags: ["kubernetes", "privileged", "container-escape", "cis-k8s"],
    references: [
      "https://cwe.mitre.org/data/definitions/250.html",
      "https://kubernetes.io/docs/concepts/security/pod-security-standards/",
    ],
    remediation:
      "Définir privileged: false et n'accorder que des Linux capabilities granulaires via securityContext.capabilities.add.",
    confidence: 0.9,
    patterns: [],
  },

  // ─── Terraform ─────────────────────────────────────────────────────────────
  {
    id: "IAC-TF-OPEN-INGRESS",
    name: "Groupe de sécurité ouvert sur 0.0.0.0/0",
    description:
      "Un security group Terraform autorise le trafic entrant depuis n'importe quelle IP publique vers un port d'administration (SSH/RDP).",
    family: "iac",
    severity: "critical",
    cwe: "CWE-284",
    owasp: "A01:2021",
    enabled: true,
    tags: ["terraform", "network", "exposure", "aws-fsbp"],
    references: [
      "https://cwe.mitre.org/data/definitions/284.html",
      "https://owasp.org/Top10/A01_2021-Broken_Access_Control/",
    ],
    remediation:
      "Restreindre le bloc CIDR à un VPN d'entreprise ou une IP bastion spécifique plutôt que 0.0.0.0/0.",
    confidence: 0.85,
    patterns: [],
  },
];
