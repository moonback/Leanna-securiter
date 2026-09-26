import crypto from "crypto";
import path from "path";

/**
 * Calcul d'empreinte digitale (Fingerprint) stable et déterministe pour dédupliquer
 * les vulnérabilités à travers les scans, même en cas de léger décalage de lignes.
 */
export function computeFingerprint(params: {
  filePath: string;
  ruleId: string;
  snippet?: string;
  functionName?: string;
  startLine?: number;
}): string {
  // Normaliser le chemin relatif (séparateurs universels unix)
  const normalizedPath = params.filePath.replace(/\\/g, "/").toLowerCase();

  // Nettoyer le snippet : supprimer espaces superflus, indentations et retours à la ligne
  const normalizedSnippet = (params.snippet || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 200);

  const raw = [
    normalizedPath,
    params.ruleId.trim().toLowerCase(),
    params.functionName || "",
    normalizedSnippet || String(params.startLine ?? 0),
  ].join("|");

  return crypto.createHash("sha256").update(raw, "utf8").digest("hex");
}
