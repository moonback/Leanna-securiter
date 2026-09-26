/**
 * ReportWriter — Persiste les rapports d'audit de sécurité DANS LA SANDBOX.
 *
 * Doctrine : la flotte sécurité est en lecture seule sur le code. Les seuls
 * artefacts écrits sont les livrables de rapport, et ils le sont exclusivement
 * dans la sandbox (`.Leanna/sandbox/`), jamais dans le workspace principal.
 *
 * Toute écriture passe par le SandboxGuard (`assertSandboxReady`) qui valide le
 * chemin (relatif, sous la racine sandbox, sans lien symbolique) et exige que
 * la sandbox soit à l'état READY. Les fichiers produits sont ensuite marqués
 * modifiés (`markFileModified`) pour apparaître dans le flux d'acceptation.
 */

import fs from "fs";
import path from "path";

import {
  isSandboxActive,
  assertSandboxReady,
  markFileModified,
  getSandboxState,
} from "../../utils/sandbox.js";

import type { Finding } from "../findings/Finding.js";
import { buildSarifReport } from "./SarifBuilder.js";
import { buildMarkdownReport, type MarkdownReportInput } from "./MarkdownReportBuilder.js";

/** Dossier (relatif à la sandbox) où sont déposés les rapports. */
const REPORT_DIR = "security-reports";

export interface WrittenReport {
  /** Chemins relatifs à la sandbox des fichiers écrits. */
  markdownPath: string;
  sarifPath: string;
}

export interface ReportWriteResult {
  written: boolean;
  /** Raison de non-écriture (sandbox non prête, erreur…). */
  reason?: string;
  report?: WrittenReport;
}

/**
 * Écrit le rapport Markdown et l'export SARIF dans la sandbox.
 *
 * Ne lève jamais : retourne un résultat structuré. Si la sandbox n'est pas
 * READY, l'écriture est ignorée (la génération de rapport ne doit pas casser
 * un scan) et la raison est retournée.
 *
 * @param input          Métadonnées + findings du scan.
 * @param workspaceRoot  Racine utilisée pour relativiser les URI SARIF.
 */
export function writeSecurityReportToSandbox(
  input: MarkdownReportInput,
  workspaceRoot?: string,
): ReportWriteResult {
  if (!isSandboxActive()) {
    return {
      written: false,
      reason: `Sandbox non prête (${getSandboxState()}) : rapport non écrit.`,
    };
  }

  const markdownRel = `${REPORT_DIR}/rapport.md`;
  const sarifRel = `${REPORT_DIR}/rapport.sarif.json`;

  try {
    const markdown = buildMarkdownReport(input);
    const sarif = buildSarifReport(input.findings as Finding[], workspaceRoot);
    const sarifJson = JSON.stringify(sarif, null, 2);

    writeFileInSandbox(markdownRel, markdown);
    writeFileInSandbox(sarifRel, sarifJson);

    return {
      written: true,
      report: { markdownPath: markdownRel, sarifPath: sarifRel },
    };
  } catch (err) {
    return {
      written: false,
      reason: `Échec d'écriture du rapport : ${(err as Error).message}`,
    };
  }
}

/**
 * Écrit un fichier texte dans la sandbox via le SandboxGuard, en créant le
 * dossier parent si nécessaire, puis marque le fichier comme modifié.
 */
function writeFileInSandbox(relPath: string, content: string): void {
  // assertSandboxReady valide le chemin (sous la racine sandbox, pas de symlink,
  // pas d'échappement) et renvoie le chemin absolu canonique sûr.
  const absPath = assertSandboxReady(relPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content, "utf-8");
  markFileModified(relPath);
}
