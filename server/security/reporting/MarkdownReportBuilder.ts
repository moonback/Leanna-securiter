/**
 * MarkdownReportBuilder — Génère un rapport d'audit de sécurité lisible (.md)
 *
 * Produit un document Markdown à partir des findings consolidés et des
 * métadonnées de scan. Le rapport est destiné à deux publics :
 *   - exécutif : posture globale, tableau de bord, top risques ;
 *   - technique : une fiche par finding (preuve, impact, remédiation).
 *
 * Les valeurs sensibles ne sont jamais recopiées en clair : les snippets de
 * secrets sont masqués (préfixe + longueur) avant insertion.
 */

import type { Finding, FindingSeverity } from "../findings/Finding.js";

export interface MarkdownReportInput {
  scanId: string;
  targetPath: string;
  profile: string;
  status: string;
  startTime: string;
  endTime?: string;
  durationMs: number;
  filesScanned: number;
  filesSkipped: number;
  findings: Finding[];
  findingsCount: {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
  };
  blockingReason?: string;
}

const SEVERITY_ORDER: Record<FindingSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

const SEVERITY_LABEL: Record<FindingSeverity, string> = {
  critical: "🔴 Critique",
  high: "🟠 Haute",
  medium: "🟡 Moyenne",
  low: "🔵 Faible",
  info: "⚪ Info",
};

/**
 * Masque une valeur potentiellement sensible : n'expose que le préfixe et la
 * longueur (ex: `sk-live-…(48 chars)`). Utilisé pour les findings de secrets.
 */
function maskSecret(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 6) return `…(${trimmed.length} chars)`;
  return `${trimmed.slice(0, 6)}…(${trimmed.length} chars)`;
}

/** Échappe les barres verticales pour ne pas casser les tableaux Markdown. */
function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/** Retourne un extrait de code sûr (secrets masqués). */
function safeSnippet(f: Finding): string | undefined {
  const snippet = f.location?.snippet;
  if (!snippet) return undefined;
  return f.scanner === "secrets" ? maskSecret(snippet) : snippet.trim();
}

function fileRef(f: Finding): string {
  const loc = f.location;
  if (!loc?.filePath) return "(emplacement inconnu)";
  return `${loc.filePath}:${loc.startLine}`;
}

/**
 * Construit le rapport Markdown complet.
 */
export function buildMarkdownReport(input: MarkdownReportInput): string {
  const lines: string[] = [];
  const { findingsCount: c } = input;

  const sortedFindings = [...input.findings].sort(
    (a, b) =>
      (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9) ||
      b.cvssScore - a.cvssScore,
  );

  // ── En-tête ────────────────────────────────────────────────────────────────
  lines.push("# Rapport d'Audit de Sécurité");
  lines.push("");
  lines.push(`- **Scan** : \`${input.scanId}\``);
  lines.push(`- **Cible** : \`${input.targetPath}\``);
  lines.push(`- **Profil** : ${input.profile}`);
  lines.push(`- **Statut** : ${input.status}${input.blockingReason ? ` — ${input.blockingReason}` : ""}`);
  lines.push(`- **Début** : ${input.startTime}`);
  if (input.endTime) lines.push(`- **Fin** : ${input.endTime}`);
  lines.push(`- **Durée** : ${input.durationMs} ms`);
  lines.push(`- **Fichiers analysés** : ${input.filesScanned} (ignorés : ${input.filesSkipped})`);
  lines.push("");

  // ── 1. Synthèse exécutive ────────────────────────────────────────────────────
  lines.push("## 1. Synthèse exécutive");
  lines.push("");
  if (c.total === 0) {
    lines.push("Aucune vulnérabilité détectée sur le périmètre analysé.");
  } else {
    const headline =
      c.critical > 0 || c.high > 0
        ? `Posture à risque : ${c.critical} critique(s) et ${c.high} haute(s) à traiter en priorité.`
        : "Aucun risque critique ou élevé ; findings de sévérité modérée à faible.";
    lines.push(headline);
    lines.push("");
    lines.push(
      `Total de **${c.total}** finding(s) : ` +
        `${c.critical} critique(s), ${c.high} haute(s), ${c.medium} moyenne(s), ` +
        `${c.low} faible(s), ${c.info} info.`,
    );
  }
  lines.push("");

  // ── 2. Tableau de bord ───────────────────────────────────────────────────────
  lines.push("## 2. Tableau de bord");
  lines.push("");
  lines.push("| Sévérité | Nombre |");
  lines.push("|----------|--------|");
  lines.push(`| ${SEVERITY_LABEL.critical} | ${c.critical} |`);
  lines.push(`| ${SEVERITY_LABEL.high} | ${c.high} |`);
  lines.push(`| ${SEVERITY_LABEL.medium} | ${c.medium} |`);
  lines.push(`| ${SEVERITY_LABEL.low} | ${c.low} |`);
  lines.push(`| ${SEVERITY_LABEL.info} | ${c.info} |`);
  lines.push(`| **Total** | **${c.total}** |`);
  lines.push("");

  // Répartition par scanner.
  const byScanner = new Map<string, number>();
  for (const f of input.findings) {
    byScanner.set(f.scanner, (byScanner.get(f.scanner) ?? 0) + 1);
  }
  if (byScanner.size > 0) {
    lines.push("### Par catégorie de scanner");
    lines.push("");
    lines.push("| Scanner | Findings |");
    lines.push("|---------|----------|");
    for (const [scanner, count] of [...byScanner.entries()].sort()) {
      lines.push(`| ${scanner} | ${count} |`);
    }
    lines.push("");
  }

  // ── 3. Top risques ───────────────────────────────────────────────────────────
  const topRisks = sortedFindings
    .filter((f) => f.severity === "critical" || f.severity === "high")
    .slice(0, 10);
  if (topRisks.length > 0) {
    lines.push("## 3. Top risques");
    lines.push("");
    lines.push("| # | Sévérité | Règle | Emplacement | CVSS |");
    lines.push("|---|----------|-------|-------------|------|");
    topRisks.forEach((f, i) => {
      lines.push(
        `| ${i + 1} | ${SEVERITY_LABEL[f.severity]} | ${escapeCell(f.ruleId)} | ` +
          `\`${escapeCell(fileRef(f))}\` | ${f.cvssScore.toFixed(1)} |`,
      );
    });
    lines.push("");
  }

  // ── 4. Findings techniques ───────────────────────────────────────────────────
  lines.push("## 4. Findings techniques");
  lines.push("");
  if (sortedFindings.length === 0) {
    lines.push("_Aucun finding._");
    lines.push("");
  } else {
    for (const f of sortedFindings) {
      lines.push(`### ${SEVERITY_LABEL[f.severity]} — ${f.title}`);
      lines.push("");
      lines.push(`- **ID** : \`${f.id}\``);
      lines.push(`- **Règle** : ${f.ruleId}${f.ruleName ? ` (${f.ruleName})` : ""}`);
      lines.push(`- **Scanner** : ${f.scanner}`);
      lines.push(`- **Emplacement** : \`${fileRef(f)}\``);
      if (f.cwe.length > 0) lines.push(`- **CWE** : ${f.cwe.join(", ")}`);
      if (f.owasp.length > 0) lines.push(`- **OWASP** : ${f.owasp.join(", ")}`);
      lines.push(
        `- **CVSS** : ${f.cvssScore.toFixed(1)}${f.cvssVector ? ` (\`${f.cvssVector}\`)` : ""}`,
      );
      if (typeof f.epssScore === "number") lines.push(`- **EPSS** : ${f.epssScore}`);
      if (f.cisaKev) lines.push(`- **CISA KEV** : oui (exploitation active connue)`);
      lines.push(`- **Statut** : ${f.status}`);
      lines.push("");

      if (f.description) {
        lines.push(f.description);
        lines.push("");
      }

      const snippet = safeSnippet(f);
      if (snippet) {
        lines.push("**Preuve :**");
        lines.push("");
        lines.push("```");
        lines.push(snippet);
        lines.push("```");
        lines.push("");
      }

      if (f.taintFlow && f.taintFlow.length > 0) {
        const chain = f.taintFlow
          .sort((a, b) => a.step - b.step)
          .map((s) => `${s.filePath}:${s.line}`)
          .join(" → ");
        lines.push(`**Chaîne source → sink :** \`${chain}\``);
        lines.push("");
      }

      if (f.impact) {
        lines.push(`**Impact :** ${f.impact}`);
        lines.push("");
      }
      if (f.remediation) {
        lines.push(`**Remédiation :** ${f.remediation}`);
        lines.push("");
      }
      if (f.references && f.references.length > 0) {
        lines.push("**Références :**");
        for (const ref of f.references) lines.push(`- ${ref}`);
        lines.push("");
      }
      lines.push("---");
      lines.push("");
    }
  }

  // ── 5. Méthodologie & limites ────────────────────────────────────────────────
  lines.push("## 5. Méthodologie & limites");
  lines.push("");
  lines.push(
    "Analyse statique et supply-chain non destructive, en lecture seule sur le " +
      "code source. Les findings dépendent des scanners activés par le profil et " +
      "des fichiers effectivement lisibles. Les valeurs secrètes sont masquées " +
      "(préfixe + longueur) et ne sont jamais recopiées en clair.",
  );
  lines.push("");

  lines.push(`_Rapport généré automatiquement le ${new Date().toISOString()}._`);
  lines.push("");

  return lines.join("\n");
}
