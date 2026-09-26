import fs from "fs";
import path from "path";
import { isWriteForbidden, isCriticalFile } from "../utils/selfRoot.js";
import { requestConfirmation, type ConfirmationRequest } from "../utils/confirmationBridge.js";
import { triggerRestartIfNeeded } from "../utils/serverRestart.js";
import { scheduleValidation } from "../utils/postEditValidator.js";
import { appendAuditEvent, generateDiffSummary } from "../audit.js";
import { isSandboxActive, markFileModified } from "../utils/sandbox.js";
import { createLogger } from "../utils/logger.js";
import { supervisor } from "../autonomy/Supervisor.js";
import {
  getProjectRoot,
  resolveWritePath,
  resolveSandboxWriteTarget,
  checkWorkspace
} from "./codebaseHelpers.js";

const log = createLogger("CodebaseWriter");

// ── Rate limiting pour les opérations d'écriture ────────────────────────────
const WRITE_RATE_LIMIT = 30; // max 30 écritures par minute
const WRITE_WINDOW_MS = 60_000;
const writeTimestamps: number[] = [];

function checkWriteRateLimit(): boolean {
  const now = Date.now();
  // Purger les entrées plus vieilles que la fenêtre
  while (writeTimestamps.length > 0 && writeTimestamps[0] < now - WRITE_WINDOW_MS) {
    writeTimestamps.shift();
  }
  if (writeTimestamps.length >= WRITE_RATE_LIMIT) {
    return false; // Rate limited
  }
  writeTimestamps.push(now);
  return true;
}

// ── Garde-fou fichiers critiques ────────────────────────────────────────────

/** Sous-ensemble des opérations de confirmation qui correspondent à une écriture fichier (exclut 'npm-command'). */
type FileOperation = Extract<ConfirmationRequest["operation"], "write" | "modify" | "patch" | "rename" | "delete">;

interface GuardResult {
  blocked: boolean;
  error?: string;
}

/**
 * Vérifie la confirmation utilisateur pour un fichier critique.
 *
 * FAIL-CLOSED : si le fichier est critique et qu'aucun canal de confirmation
 * n'est disponible (appel autonome via AgentOrchestrator/MissionExecutor, qui
 * n'injectent pas toolContext.emitToClient), l'opération est refusée directement.
 */
async function guardCriticalFile(
  critical: boolean,
  requestedPath: string,
  operation: FileOperation,
  toolContext: any,
  reason: string | undefined,
  content?: { proposed?: string; previous?: string; renameTo?: string }
): Promise<GuardResult> {
  if (!critical) return { blocked: false };

  // ── Cas 1 : pas de canal de confirmation interactif (agent/mission autonome)
  if (!toolContext?.emitToClient) {
    console.warn(`[Codebase] Écriture critique bloquée : pas de canal de confirmation interactif pour ${operation} sur ${requestedPath}`);
    return {
      blocked: true,
      error: `Opération refusée : ${requestedPath} est un fichier critique et aucune confirmation interactive n'est possible dans ce contexte d'exécution.`,
    };
  }

  // ── Cas 2 : canal disponible → confirmation interactive classique
  const approved = await requestConfirmation(requestedPath, operation, toolContext.emitToClient, reason);
  if (!approved) {
    return {
      blocked: true,
      error: `Modification refusée par l'utilisateur: ${requestedPath} est un fichier critique.`,
    };
  }

  return { blocked: false };
}

function resolveCurrentSandboxPath(requestedPath: string, expectedPath: string): string | null {
  const currentPath = resolveWritePath(requestedPath);
  return currentPath === expectedPath ? currentPath : null;
}

// ─── Writer Handlers ──────────────────────────────────────────────────────────

export async function handleWriteProjectFile(args: any, toolContext: any) {
  if (!checkWriteRateLimit()) return { error: "Rate limit atteint : trop d'écritures par minute. Attendez avant de modifier d'autres fichiers." };
  if (!checkWorkspace().exists) return { error: "Workspace non disponible.", path: getProjectRoot() };
  const requestedPath = String(args.path || "").trim();
  const content = String(args.content || "");
  // Mode append : ajouter à la fin du fichier sans écraser le contenu existant
  const appendMode = args.append === true;
  if (!requestedPath) return { error: "Le chemin de fichier est requis." };
  const target = resolveSandboxWriteTarget(requestedPath);
  if (!target) return { error: "Chemin invalide ou en dehors du workspace." };
  const normalized = target.sandboxPath;
  if (isWriteForbidden(target.logicalPath)) return { error: `Écriture interdite sur ce fichier protégé: ${requestedPath}` };
  const critical = isCriticalFile(target.logicalPath);

  const writePath = normalized;
  const sandboxMode = isSandboxActive();
  let beforeContent: string | null = null;
  try { beforeContent = fs.existsSync(writePath) ? await fs.promises.readFile(writePath, "utf-8") : null; } catch { /* nouveau fichier */ }

  // En mode append, construire le contenu final
  const finalContent = appendMode && beforeContent !== null
    ? (beforeContent.endsWith("\n") ? beforeContent + content : beforeContent + "\n" + content)
    : content;

  const guard = await guardCriticalFile(
    critical,
    requestedPath,
    "write",
    toolContext,
    appendMode
      ? `Ajout de ${Buffer.byteLength(content, "utf-8")} octets en fin de fichier`
      : `Écriture de ${Buffer.byteLength(content, "utf-8")} octets`,
    { proposed: finalContent, previous: beforeContent ?? undefined }
  );
  if (guard.blocked) return { error: guard.error, critical: true };

  if (!sandboxMode) {
    try {
      const { createCheckpoint } = await import("../utils/checkpoint");
      await createCheckpoint(`avant écriture: ${requestedPath}`);
    } catch { /* non bloquant */ }
  }
  
  // Enregistrer le hash du fichier avant écriture pour détection de boucle
  if (beforeContent !== null) {
    supervisor.recordFileHashBefore(target.logicalPath, beforeContent);
  }
  
  if (!resolveCurrentSandboxPath(requestedPath, writePath)) return { error: "Sandbox indisponible ou chemin modifié — écriture refusée." };
  await fs.promises.mkdir(path.dirname(writePath), { recursive: true });
  await fs.promises.writeFile(writePath, finalContent, "utf-8");
  if (sandboxMode) markFileModified(requestedPath);
  console.log(`[Codebase] File ${appendMode ? "appended" : "written"}: ${requestedPath}${critical ? " [CRITIQUE]" : ""}${sandboxMode ? " [SANDBOX]" : ""}`);
  appendAuditEvent({ action: "write_project_file", target: requestedPath, actor: "ai", diff: generateDiffSummary(beforeContent, finalContent) }).catch((err) => {
    console.warn(`[Audit] appendAuditEvent failed for write_project_file on ${requestedPath}:`, err);
  });
  toolContext.emitIdeAction?.({ type: "open-file", path: requestedPath });
  toolContext.emitIdeAction?.({ type: "file-changed", path: requestedPath });
  if (!sandboxMode) {
    triggerRestartIfNeeded(requestedPath);
    scheduleValidation(true, toolContext?.supervisor);
  }
  return {
    status: "success",
    path: requestedPath,
    mode: appendMode ? "append" : "write",
    bytesWritten: Buffer.byteLength(content, "utf-8"),
    totalBytes: Buffer.byteLength(finalContent, "utf-8"),
    critical,
    sandbox: sandboxMode,
    message: `File ${requestedPath} ${appendMode ? "appended" : "written"} successfully.${sandboxMode ? " 📦 (sandbox)" : ""}${critical ? " ⚠️ Fichier critique modifié." : ""}`,
  };
}

export async function handleModifyProjectFile(args: any, toolContext: any) {
  if (!checkWriteRateLimit()) return { error: "Rate limit atteint : trop d'écritures par minute." };
  if (!checkWorkspace().exists) return { error: "Workspace non disponible.", path: getProjectRoot() };
  const requestedPath = String(args.path || "").trim();
  let searchText = String(args.searchText || "");
  const replaceText = String(args.replaceText ?? "");
  const replaceAll = args.replaceAll === true;
  const startMarker = args.startMarker ? String(args.startMarker).trim() : null;
  const endMarker = args.endMarker ? String(args.endMarker).trim() : null;

  if (!requestedPath) return { error: "Le chemin de fichier est requis. Exemple: modify_project_file({ path: 'src/file.ts', searchText: 'texte exact', replaceText: 'nouveau texte' })" };

  // Mode startMarker/endMarker : le backend construit searchText depuis le fichier
  if (!searchText && startMarker && endMarker) {
    const target = resolveSandboxWriteTarget(requestedPath);
    if (!target) return { error: "Chemin invalide ou en dehors du workspace." };
    if (!fs.existsSync(target.sandboxPath)) return { error: "Fichier introuvable." };
    const rawContent = await fs.promises.readFile(target.sandboxPath, "utf-8");
    const content = rawContent.replace(/\r\n/g, "\n");
    const normalizedStartMarker = startMarker.replace(/\r\n/g, "\n");
    const normalizedEndMarker = endMarker.replace(/\r\n/g, "\n");
    const startIdx = content.indexOf(normalizedStartMarker);
    const endIdx = startIdx >= 0 ? content.indexOf(normalizedEndMarker, startIdx) : -1;
    if (startIdx === -1) return { error: `startMarker introuvable dans le fichier: "${startMarker.slice(0, 80)}"` };
    if (endIdx === -1) return { error: `endMarker introuvable après startMarker: "${endMarker.slice(0, 80)}"` };
    searchText = content.slice(startIdx, endIdx + normalizedEndMarker.length);
    log.info(`[modify_project_file] Mode marker: searchText construit (${searchText.length} chars) depuis startMarker/endMarker`);
  }

  if (!searchText) return { error: "searchText est OBLIGATOIRE et ne peut pas être vide. Tu DOIS d'abord lire le fichier avec read_project_file({ path, full: true }) puis copier le texte EXACT à remplacer dans searchText. Alternative: utilise startMarker et endMarker pour délimiter le bloc à remplacer." };
  const target = resolveSandboxWriteTarget(requestedPath);
  if (!target) return { error: "Chemin invalide ou en dehors du workspace." };
  const normalized = target.sandboxPath;
  if (isWriteForbidden(target.logicalPath)) return { error: `Écriture interdite sur ce fichier protégé: ${requestedPath}` };
  if (!fs.existsSync(normalized)) return { error: "Fichier introuvable." };

  const raw = await fs.promises.readFile(normalized, "utf-8");
  const isCrlf = raw.includes("\r\n");
  const content = raw.replace(/\r\n/g, "\n");
  const normalizedSearchText = searchText.replace(/\r\n/g, "\n");
  const normalizedReplaceText = replaceText.replace(/\r\n/g, "\n");

  if (!content.includes(normalizedSearchText)) {
    // ── Fuzzy match : trouver les passages les plus proches ─────────────────
    const lines = content.split("\n");
    const searchLines = normalizedSearchText.split("\n");
    const firstSearchLine = searchLines[0].trim();

    // Chercher les lignes qui ressemblent à la première ligne du searchText
    const candidates: Array<{ lineNo: number; lineContent: string; similarity: number }> = [];
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (!trimmed) continue;
      // Similarité simple : ratio de caractères communs
      const longer = Math.max(firstSearchLine.length, trimmed.length);
      if (longer === 0) continue;
      const shorter = Math.min(firstSearchLine.length, trimmed.length);
      let common = 0;
      for (let c = 0; c < shorter; c++) {
        if (firstSearchLine[c] === trimmed[c]) common++;
      }
      const similarity = common / longer;
      if (similarity > 0.4) {
        candidates.push({ lineNo: i + 1, lineContent: lines[i], similarity });
      }
    }
    candidates.sort((a, b) => b.similarity - a.similarity);
    const topCandidates = candidates.slice(0, 3);

    return {
      error: `searchText introuvable dans "${requestedPath}". Le texte fourni ne correspond à aucun passage exact du fichier (espaces, indentation ou retours à la ligne différents).`,
      action: `Relis avec read_project_file({ path: "${requestedPath}", full: true }) et copie le texte EXACT. Alternative : utilise startMarker/endMarker pour délimiter le bloc.`,
      totalLines: lines.length,
      searchTextLength: searchText.length,
      ...(topCandidates.length > 0 && {
        suggestions: topCandidates.map(c => ({
          line: c.lineNo,
          content: c.lineContent,
          hint: `Ligne ${c.lineNo} ressemble à votre searchText (similarité: ${Math.round(c.similarity * 100)}%)`,
        })),
      }),
    };
  }

  const occurrences = content.split(normalizedSearchText).length - 1;
  const replacedContent = replaceAll
    ? content.split(normalizedSearchText).join(normalizedReplaceText)
    : content.replace(normalizedSearchText, () => normalizedReplaceText);
  const newContent = isCrlf ? replacedContent.replace(/\n/g, "\r\n") : replacedContent;

  const critical = isCriticalFile(target.logicalPath);
  // Confirmation interactive (ou mise en file d'attente) pour fichiers critiques
  const guard = await guardCriticalFile(
    critical,
    requestedPath,
    'modify',
    toolContext,
    `Remplacement de texte`,
    { proposed: newContent, previous: content }
  );
  if (guard.blocked) return { error: guard.error, critical: true };

  const sandboxMode = isSandboxActive();
  // Checkpoint automatique avant modification (seulement en mode direct)
  if (!sandboxMode) {
    try {
      const { createCheckpoint } = await import("../utils/checkpoint");
      await createCheckpoint(`avant modification: ${requestedPath}`);
    } catch { /* non bloquant */ }
  }
  
  // Enregistrer le hash du fichier avant modification pour détection de boucle
  supervisor.recordFileHashBefore(target.logicalPath, content);
  
  if (!resolveCurrentSandboxPath(requestedPath, normalized)) return { error: "Sandbox indisponible ou chemin modifié — écriture refusée." };
  await fs.promises.writeFile(normalized, newContent, "utf-8");
  if (sandboxMode) markFileModified(requestedPath);
  console.log(`[Codebase] File modified: ${requestedPath}${critical ? ' [CRITIQUE]' : ''}${sandboxMode ? ' [SANDBOX]' : ''}`);
  appendAuditEvent({ action: 'modify_project_file', target: requestedPath, actor: 'ai', diff: generateDiffSummary(content, newContent) }).catch((err) => {
    console.warn(`[Audit] appendAuditEvent failed for modify_project_file on ${requestedPath}:`, err);
  });
  toolContext.emitIdeAction?.({ type: "open-file", path: requestedPath });
  toolContext.emitIdeAction?.({ type: "file-changed", path: requestedPath });
  if (!sandboxMode) {
    triggerRestartIfNeeded(requestedPath);
    scheduleValidation(true, toolContext?.supervisor);
  }
  return { status: "success", path: requestedPath, replacements: replaceAll ? occurrences : 1, critical, sandbox: sandboxMode, message: `File ${requestedPath} modified successfully.${sandboxMode ? ' 📦 (sandbox)' : ''}${critical ? ' ⚠️ Fichier critique modifié.' : ''}` };
}

export async function handlePatchProjectFile(args: any, toolContext: any) {
  if (!checkWriteRateLimit()) return { error: "Rate limit atteint : trop d'écritures par minute." };
  if (!checkWorkspace().exists) return { error: "Workspace non disponible.", path: getProjectRoot() };
  const requestedPath = String(args.path || "").trim();
  if (!requestedPath) return { error: "Le chemin de fichier est requis." };
  if (!args.operations || !Array.isArray(args.operations) || args.operations.length === 0) {
    return { error: "Au moins une opération est requise dans 'operations'." };
  }
  const target = resolveSandboxWriteTarget(requestedPath);
  if (!target) return { error: "Chemin invalide ou en dehors du workspace." };
  const normalized = target.sandboxPath;
  if (isWriteForbidden(target.logicalPath)) return { error: `Écriture interdite sur ce fichier protégé: ${requestedPath}` };
  if (!fs.existsSync(normalized)) return { error: "Fichier introuvable." };

  const raw = await fs.promises.readFile(normalized, "utf-8");
  let lines = raw.split(/\r?\n/);
  let appliedOps = 0;

  const normalizedOps = args.operations.map((op: any) => {
    const startLine = typeof op.startLine === "number" ? op.startLine : 0;
    const endLine = typeof op.endLine === "number" ? op.endLine : startLine;
    return { ...op, __rangeStart: startLine, __rangeEnd: op.type === "insert" ? startLine : endLine };
  });
  const sortedOps = [...normalizedOps].sort((a: any, b: any) => (b.__rangeStart || 0) - (a.__rangeStart || 0));

  // Les opérations sont triées par __rangeStart décroissant :
  //   sortedOps[i].__rangeStart  ≥  sortedOps[i+1].__rangeStart
  // Il y a chevauchement si le début de l'op de plus haut index (a)
  // est ≤ la fin de l'op de plus bas index (b), c'est-à-dire si les
  // plages [b.start, b.end] et [a.start, a.end] se recoupent.
  for (let i = 0; i < sortedOps.length - 1; i++) {
    const a = sortedOps[i];     // plage haute  (start ≥ b.start)
    const b = sortedOps[i + 1]; // plage basse
    const aStart = a.__rangeStart || 0;
    const bEnd   = b.__rangeEnd   || 0;
    if (aStart <= bEnd) {
      return {
        error: `Opérations qui se chevauchent détectées (lignes ${b.__rangeStart}-${b.__rangeEnd} et ${a.__rangeStart}-${a.__rangeEnd}). Fusionne-les en une seule opération ou sépare-les en plages disjointes.`,
      };
    }
  }

  for (const op of sortedOps) {
    const type = String(op.type || "").trim();
    const startLine = typeof op.startLine === "number" ? op.startLine : 0;
    const endLine = typeof op.endLine === "number" ? op.endLine : startLine;
    const content = typeof op.content === "string" ? op.content : "";

    if (startLine < 1 || startLine > lines.length + 1) {
      return { error: `Ligne ${startLine} hors limites (fichier: ${lines.length} lignes).` };
    }

    switch (type) {
      case "replace": {
        if (endLine < startLine || endLine > lines.length) {
          return { error: `endLine ${endLine} invalide pour replace (max: ${lines.length}).` };
        }
        const newLines = content.split("\n");
        lines.splice(startLine - 1, endLine - startLine + 1, ...newLines);
        appliedOps++;
        break;
      }
      case "insert": {
        const newLines = content.split("\n");
        lines.splice(startLine, 0, ...newLines); // Insert after startLine
        appliedOps++;
        break;
      }
      case "delete": {
        if (endLine < startLine || endLine > lines.length) {
          return { error: `endLine ${endLine} invalide pour delete (max: ${lines.length}).` };
        }
        lines.splice(startLine - 1, endLine - startLine + 1);
        appliedOps++;
        break;
      }
      default:
        return { error: `Type d'opération inconnu: '${type}'. Utilise 'replace', 'insert' ou 'delete'.` };
    }
  }

  const newContent = lines.join("\n");

  const critical = isCriticalFile(target.logicalPath);
  // Confirmation interactive (ou mise en file d'attente) pour fichiers critiques
  const guard = await guardCriticalFile(
    critical,
    requestedPath,
    'patch',
    toolContext,
    `Patch (${args.operations.length} opération(s))`,
    { proposed: newContent, previous: raw }
  );
  if (guard.blocked) return { error: guard.error, critical: true };

  // Checkpoint automatique avant patch (seulement en mode direct)
  const sandboxMode_patch = isSandboxActive();
  if (!sandboxMode_patch) {
    try {
      const { createCheckpoint } = await import("../utils/checkpoint");
      await createCheckpoint(`avant patch: ${requestedPath}`);
    } catch { /* non bloquant */ }
  }

  // Enregistrer le hash du fichier avant patch pour détection de boucle
  supervisor.recordFileHashBefore(target.logicalPath, raw);

  if (!resolveCurrentSandboxPath(requestedPath, normalized)) return { error: "Sandbox indisponible ou chemin modifié — écriture refusée." };
  await fs.promises.writeFile(normalized, newContent, "utf-8");
  if (sandboxMode_patch) markFileModified(requestedPath);
  console.log(`[Codebase] File patched: ${requestedPath} (${appliedOps} ops)${critical ? ' [CRITIQUE]' : ''}${sandboxMode_patch ? ' [SANDBOX]' : ''}`);
  appendAuditEvent({ action: 'patch_project_file', target: requestedPath, actor: 'ai', diff: generateDiffSummary(raw, newContent) }).catch((err) => {
    console.warn(`[Audit] appendAuditEvent failed for patch_project_file on ${requestedPath}:`, err);
  });
  toolContext.emitIdeAction?.({ type: "open-file", path: requestedPath });
  toolContext.emitIdeAction?.({ type: "file-changed", path: requestedPath });
  if (!sandboxMode_patch) {
    triggerRestartIfNeeded(requestedPath);
    scheduleValidation(true, toolContext?.supervisor);
  }
  return {
    status: "success",
    path: requestedPath,
    operationsApplied: appliedOps,
    newTotalLines: lines.length,
    critical,
    sandbox: sandboxMode_patch,
    message: `File ${requestedPath} patched successfully (${appliedOps} operations).${sandboxMode_patch ? ' 📦 (sandbox)' : ''}${critical ? ' ⚠️ Fichier critique modifié.' : ''}`,
  };
}

/**
 * Applique un diff unifié en vérifiant chaque hunk contre le contenu courant.
 * Le fichier n'est écrit qu'après validation de tous les hunks, afin d'éviter
 * les remplacements silencieux sur un fichier devenu obsolète.
 */
export async function handleApplyPatch(args: any, toolContext: any) {
  if (!checkWriteRateLimit()) return { error: "Rate limit atteint : trop d'écritures par minute." };
  if (!checkWorkspace().exists) return { error: "Workspace non disponible.", path: getProjectRoot() };

  const requestedPath = String(args.path || "").trim();
  const patch = typeof args.patch === "string" ? args.patch.replace(/\r\n/g, "\n") : "";
  if (!requestedPath) return { error: "Le chemin de fichier est requis." };
  if (!patch.trim()) return { error: "Le diff unifié est requis." };

  const target = resolveSandboxWriteTarget(requestedPath);
  if (!target) return { error: "Chemin invalide ou en dehors du workspace." };
  const normalized = target.sandboxPath;
  if (isWriteForbidden(target.logicalPath)) return { error: `Écriture interdite sur ce fichier protégé: ${requestedPath}` };
  if (!fs.existsSync(normalized)) return { error: "Fichier introuvable." };

  const raw = await fs.promises.readFile(normalized, "utf-8");
  const sourceLines = raw.replace(/\r\n/g, "\n").split("\n");
  const patchLines = patch.split("\n");
  const hunks: Array<{ start: number; oldLines: string[]; newLines: string[] }> = [];
  let current: { start: number; oldLines: string[]; newLines: string[] } | null = null;

  for (const line of patchLines) {
    const header = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (header) {
      if (current) hunks.push(current);
      current = { start: Number(header[1]), oldLines: [], newLines: [] };
      continue;
    }
    if (!current) continue;
    if (line === "\\ No newline at end of file") continue;
    if (line.startsWith(" ")) {
      const value = line.slice(1);
      current.oldLines.push(value);
      current.newLines.push(value);
    } else if (line.startsWith("-")) {
      current.oldLines.push(line.slice(1));
    } else if (line.startsWith("+")) {
      current.newLines.push(line.slice(1));
    }
  }
  if (current) hunks.push(current);
  if (hunks.length === 0) return {
    error: "Diff unifié invalide : aucun hunk @@ ... @@ trouvé. Utilise UNIQUEMENT le format unifié standard (git diff). Exemple correct :\n--- a/src/file.tsx\n+++ b/src/file.tsx\n@@ -10,4 +10,4 @@\n context line\n-old line\n+new line\n context line\nFormats NON supportés : '*** Begin Patch', 'Index:', 'diff -e', diff contextuel.",
  };

  // Vérifier d'abord tous les contextes sur le fichier original.
  // Tolérance trailing-whitespace : on compare les lignes après trim droit
  // pour éviter les faux rejets dus aux fins de ligne ou espaces invisibles.
  for (const hunk of hunks) {
    const offset = hunk.start - 1;
    const actual = sourceLines.slice(offset, offset + hunk.oldLines.length);
    if (actual.length !== hunk.oldLines.length) {
      return {
        error: `Contexte du patch dépasse la fin du fichier à partir de la ligne ${hunk.start}. Le fichier a ${sourceLines.length} lignes.`,
      };
    }
    // Première passe : correspondance exacte
    const exactMatch = actual.every((line, idx) => line === hunk.oldLines[idx]);
    if (!exactMatch) {
      // Deuxième passe : tolérance whitespace (trim droit uniquement)
      const softMatch = actual.every((line, idx) => line.trimEnd() === hunk.oldLines[idx].trimEnd());
      if (!softMatch) {
        return {
          error: `Contexte du patch obsolète ou incorrect autour de la ligne ${hunk.start}. Relis le fichier et régénère le diff unifié.`,
          expected: hunk.oldLines.slice(0, 20).join("\\n"),
          actual: actual.slice(0, 20).join("\\n"),
        };
      }
      // Soft match OK : normaliser les lignes de contexte pour éviter le diff parasite
      hunk.oldLines = actual; // utiliser le contenu réel pour l'application
    }
  }

  // Appliquer du bas vers le haut : les lignes des hunks restent stables.
  const nextLines = [...sourceLines];
  for (const hunk of [...hunks].sort((a, b) => b.start - a.start)) {
    nextLines.splice(hunk.start - 1, hunk.oldLines.length, ...hunk.newLines);
  }
  const newContent = nextLines.join("\n");
  const critical = isCriticalFile(target.logicalPath);
  const guard = await guardCriticalFile(critical, requestedPath, "patch", toolContext, `Diff unifié (${hunks.length} hunk(s))`, { proposed: newContent, previous: raw });
  if (guard.blocked) return { error: guard.error, critical: true };

  const sandboxMode = isSandboxActive();
  if (!sandboxMode) {
    try {
      const { createCheckpoint } = await import("../utils/checkpoint");
      await createCheckpoint(`avant apply_patch: ${requestedPath}`);
    } catch { /* non bloquant */ }
  }
  if (!resolveCurrentSandboxPath(requestedPath, normalized)) return { error: "Sandbox indisponible ou chemin modifié — patch refusé." };
  await fs.promises.writeFile(normalized, newContent, "utf-8");
  if (sandboxMode) markFileModified(requestedPath);
  appendAuditEvent({ action: "apply_patch", target: requestedPath, actor: "ai", diff: generateDiffSummary(raw, newContent) }).catch((err) => {
    console.warn(`[Audit] appendAuditEvent failed for apply_patch on ${requestedPath}:`, err);
  });
  toolContext.emitIdeAction?.({ type: "open-file", path: requestedPath });
  toolContext.emitIdeAction?.({ type: "file-changed", path: requestedPath });
  if (!sandboxMode) {
    triggerRestartIfNeeded(requestedPath);
    scheduleValidation(true, toolContext?.supervisor);
  }
  return {
    status: "success",
    path: requestedPath,
    hunksApplied: hunks.length,
    critical,
    sandbox: sandboxMode,
    message: `Diff unifié appliqué avec succès à ${requestedPath}.${sandboxMode ? " 📦 (sandbox)" : ""}${critical ? " ⚠️ Fichier critique modifié." : ""}`,
  };
}

export async function handleRenameProjectFile(args: any, toolContext: any) {
  if (!checkWorkspace().exists) return { error: "Workspace non disponible.", path: getProjectRoot() };
  const oldPath = String(args.oldPath || "").trim();
  const newPath = String(args.newPath || "").trim();
  if (!oldPath || !newPath) return { error: "oldPath et newPath sont requis." };
  const oldTarget = resolveSandboxWriteTarget(oldPath);
  const newTarget = resolveSandboxWriteTarget(newPath);
  if (!oldTarget || !newTarget) return { error: "Chemin invalide ou en dehors du workspace." };
  const normalizedOld = oldTarget.sandboxPath;
  const normalizedNew = newTarget.sandboxPath;
  if (isWriteForbidden(oldTarget.logicalPath)) return { error: `Renommage interdit sur ce fichier protégé: ${oldPath}` };
  if (isWriteForbidden(newTarget.logicalPath)) return { error: `Destination interdite (fichier protégé): ${newPath}` };
  if (!fs.existsSync(normalizedOld)) return { error: `Introuvable: ${oldPath}` };

  const critical = isCriticalFile(oldTarget.logicalPath) || isCriticalFile(newTarget.logicalPath);
  // Confirmation interactive (ou mise en file d'attente) pour fichiers critiques.
  // Pas de contenu à joindre (un renommage ne change pas le contenu), mais
  // on transmet renameTo pour que l'UI affiche "ancien → nouveau" au lieu
  // d'un diff vide.
  const guard = await guardCriticalFile(critical, oldPath, 'rename', toolContext, `Renommage vers ${newPath}`, { renameTo: newPath });
  if (guard.blocked) return { error: guard.error, critical: true };

  const sandboxMode_ren = isSandboxActive();
  // Checkpoint automatique avant renommage (seulement en mode direct)
  if (!sandboxMode_ren) {
    try {
      const { createCheckpoint } = await import("../utils/checkpoint");
      await createCheckpoint(`avant renommage: ${oldPath} → ${newPath}`);
    } catch { /* non bloquant */ }
  }
  if (!resolveCurrentSandboxPath(oldPath, normalizedOld) || !resolveCurrentSandboxPath(newPath, normalizedNew)) {
    return { error: "Sandbox indisponible ou chemin modifié — renommage refusé." };
  }
  await fs.promises.mkdir(path.dirname(normalizedNew), { recursive: true });
  await fs.promises.rename(normalizedOld, normalizedNew);
  if (sandboxMode_ren) { markFileModified(oldPath); markFileModified(newPath); }
  console.log(`[Codebase] Renamed: ${oldPath} -> ${newPath}${critical ? ' [CRITIQUE]' : ''}${sandboxMode_ren ? ' [SANDBOX]' : ''}`);
  if (!sandboxMode_ren) {
    triggerRestartIfNeeded(oldPath);
    triggerRestartIfNeeded(newPath);
    scheduleValidation(true, toolContext?.supervisor);
  }
  return { status: "success", oldPath, newPath, critical, sandbox: sandboxMode_ren, message: `Renamed ${oldPath} to ${newPath}.${sandboxMode_ren ? ' 📦 (sandbox)' : ''}${critical ? ' ⚠️ Fichier critique impliqué.' : ''}` };
}

export async function handleDeleteProjectFile(args: any, toolContext: any) {
  if (!checkWriteRateLimit()) return { error: "Rate limit atteint : trop d'écritures par minute." };
  if (!checkWorkspace().exists) return { error: "Workspace non disponible.", path: getProjectRoot() };
  const requestedPath = String(args.path || "").trim();
  if (!requestedPath) return { error: "Le chemin de fichier est requis." };
  const target = resolveSandboxWriteTarget(requestedPath);
  if (!target) return { error: "Chemin invalide ou en dehors du workspace." };
  const normalized = target.sandboxPath;
  if (isWriteForbidden(target.logicalPath)) return { error: `Suppression interdite sur ce fichier protégé: ${requestedPath}` };
  if (!fs.existsSync(normalized)) return { error: "Fichier introuvable." };
  const stats = await fs.promises.stat(normalized);
  if (!stats.isFile()) return { error: "Le chemin doit pointer vers un fichier." };

  // Lire le contenu avant suppression : nécessaire pour le rollback via la
  // proposition evolutionStore si l'opération est bloquée en mode autonome.
  let beforeContent: string | null = null;
  try { beforeContent = await fs.promises.readFile(normalized, 'utf-8'); } catch { /* fichier binaire ou illisible */ }

  const critical = isCriticalFile(target.logicalPath);
  const guard = await guardCriticalFile(
    critical,
    requestedPath,
    'delete',
    toolContext,
    `Suppression du fichier`,
    { previous: beforeContent ?? undefined }
  );
  if (guard.blocked) return { error: guard.error, critical: true };

  const sandboxMode_del = isSandboxActive();
  // Checkpoint automatique avant suppression (seulement en mode direct)
  if (!sandboxMode_del) {
    try {
      const { createCheckpoint } = await import("../utils/checkpoint");
      await createCheckpoint(`avant suppression: ${requestedPath}`);
    } catch { /* non bloquant */ }
  }
  if (!resolveCurrentSandboxPath(requestedPath, normalized)) return { error: "Sandbox indisponible ou chemin modifié — suppression refusée." };
  await fs.promises.unlink(normalized);
  if (sandboxMode_del) markFileModified(requestedPath);
  console.log(`[Codebase] File deleted: ${requestedPath}${critical ? ' [CRITIQUE]' : ''}${sandboxMode_del ? ' [SANDBOX]' : ''}`);
  appendAuditEvent({ action: 'delete_project_file', target: requestedPath, actor: 'ai', diff: '[DELETED]' }).catch((err) => {
    console.warn(`[Audit] appendAuditEvent failed for delete_project_file on ${requestedPath}:`, err);
  });
  if (!sandboxMode_del) {
    triggerRestartIfNeeded(requestedPath);
    scheduleValidation(true, toolContext?.supervisor);
  }
  return { status: "success", path: requestedPath, critical, sandbox: sandboxMode_del, message: `File ${requestedPath} deleted.${sandboxMode_del ? ' 📦 (sandbox)' : ''}${critical ? ' ⚠️ Fichier critique supprimé.' : ''}` };
}

export async function handleDeleteProjectFolder(args: any, toolContext: any) {
  if (!checkWriteRateLimit()) return { error: "Rate limit atteint : trop d'écritures par minute." };
  if (!checkWorkspace().exists) return { error: "Workspace non disponible.", path: getProjectRoot() };
  const requestedPath = String(args.path || "").trim();
  if (!requestedPath) return { error: "Le chemin du dossier est requis." };

  const target = resolveSandboxWriteTarget(requestedPath);
  if (!target) return { error: "Chemin invalide ou en dehors du workspace." };
  const normalized = target.sandboxPath;

  if (isWriteForbidden(target.logicalPath)) return { error: `Suppression interdite sur ce dossier protégé: ${requestedPath}` };
  if (!fs.existsSync(normalized)) return { error: "Dossier introuvable." };

  const stats = await fs.promises.stat(normalized);
  if (!stats.isDirectory()) return { error: "Le chemin doit pointer vers un dossier. Pour supprimer un fichier, utilise delete_project_file." };

  // Garde : refuser la suppression de la racine du workspace ou de dossiers critiques de premier niveau
  const PROTECTED_DIRS = new Set(['.git', '.Leanna', 'node_modules', 'electron', '.env', '.husky']);
  const topLevel = requestedPath.replace(/\\/g, '/').split('/')[0];
  if (!topLevel || topLevel === '.' || PROTECTED_DIRS.has(topLevel)) {
    return { error: `Suppression interdite sur le dossier protégé ou racine: ${requestedPath}` };
  }

  // Compter les fichiers affectés pour informer l'utilisateur
  let fileCount = 0;
  try {
    const countFiles = async (dir: string): Promise<number> => {
      let total = 0;
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        total += e.isDirectory() ? await countFiles(path.join(dir, e.name)) : 1;
      }
      return total;
    };
    fileCount = await countFiles(normalized);
  } catch { /* non bloquant */ }

  // Confirmation requise si dossier non vide
  if (fileCount > 0 && toolContext?.emitToClient) {
    const { requestConfirmation } = await import("../utils/confirmationBridge");
    const approved = await requestConfirmation(
      requestedPath,
      'delete',
      toolContext.emitToClient,
      `Suppression récursive de ${fileCount} fichier(s) dans "${requestedPath}"`
    );
    if (!approved) {
      return { error: `Suppression annulée par l'utilisateur. Le dossier "${requestedPath}" contient ${fileCount} fichier(s).`, cancelled: true };
    }
  } else if (fileCount > 0 && !toolContext?.emitToClient) {
    // Fail-closed : pas de canal de confirmation interactif pour une suppression non vide
    return {
      error: `Suppression refusée : le dossier "${requestedPath}" contient ${fileCount} fichier(s) et aucune confirmation interactive n'est possible dans ce contexte d'exécution.`,
    };
  }

  const sandboxMode_dir = isSandboxActive();

  // Checkpoint automatique avant suppression (seulement en mode direct)
  if (!sandboxMode_dir) {
    try {
      const { createCheckpoint } = await import("../utils/checkpoint");
      await createCheckpoint(`avant suppression dossier: ${requestedPath}`);
    } catch { /* non bloquant */ }
  }

  if (!resolveCurrentSandboxPath(requestedPath, normalized)) return { error: "Sandbox indisponible ou chemin modifié — suppression refusée." };

  await fs.promises.rm(normalized, { recursive: true, force: true });

  if (sandboxMode_dir) markFileModified(requestedPath);
  console.log(`[Codebase] Directory deleted: ${requestedPath} (${fileCount} files)${sandboxMode_dir ? ' [SANDBOX]' : ''}`);
  appendAuditEvent({ action: 'delete_project_folder', target: requestedPath, actor: 'ai', diff: `[DELETED FOLDER — ${fileCount} files]` }).catch((err) => {
    console.warn(`[Audit] appendAuditEvent failed for delete_project_folder on ${requestedPath}:`, err);
  });
  if (!sandboxMode_dir) {
    scheduleValidation();
  }
  return {
    status: "success",
    path: requestedPath,
    filesDeleted: fileCount,
    sandbox: sandboxMode_dir,
    message: `Dossier "${requestedPath}" supprimé (${fileCount} fichier(s) supprimé(s)).${sandboxMode_dir ? ' 📦 (sandbox)' : ''}`,
  };
}

export async function handleCreateProjectDirectory(args: any) {
  if (!checkWorkspace().exists) return { error: "Workspace non disponible.", path: getProjectRoot() };
  const requestedPath = String(args.path || "").trim();
  if (!requestedPath) return { error: "Le chemin du dossier est requis." };
  const target = resolveSandboxWriteTarget(requestedPath);
  if (!target) return { error: "Sandbox indisponible ou chemin invalide. Les écritures sont autorisées uniquement lorsque le sandbox est READY." };
  const normalized = target.sandboxPath;
  if (isWriteForbidden(target.logicalPath)) return { error: `Création interdite dans ce dossier protégé: ${requestedPath}` };
  if (!resolveCurrentSandboxPath(requestedPath, normalized)) return { error: "Sandbox indisponible ou chemin modifié — création de dossier refusée." };
  await fs.promises.mkdir(normalized, { recursive: true });
  console.log(`[Codebase] Directory created: ${requestedPath}`);
  return { status: "success", path: requestedPath, message: `Directory ${requestedPath} created.` };
}