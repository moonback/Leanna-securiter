import { createHash } from "crypto";

export type VerificationSeverity = "info" | "warning" | "error" | "critical";
export interface VerificationIssue { type: string; file: string; line: number | null; column: number | null; severity: VerificationSeverity; rule: string; message: string; suggestion?: string; }

/** Immutable evidence that verification checked one exact on-disk file version. */
export interface VerificationRecord {
  file: string;
  /** Compatibility hash: the content actually observed after verification. */
  contentHash: string;
  hashBefore: string;
  hashAfter: string;
  verifiedAt: string;
  ok: boolean;
  status: "success" | "failed" | "stale";
  issues: VerificationIssue[];
  allIssues: VerificationIssue[];
}

export interface WorkspaceFileState {
  path: string;
  exists: boolean;
  contentHash: string;
  previousHash?: string;
  /** @deprecated Use contentHash. Kept for existing callers. */
  hash: string;
  content?: string;
  version: number;
  readAt?: string;
  writtenAt?: string;
  verifiedHash?: string;
  verifiedAt?: string;
  status: "unread" | "read" | "modified" | "verified" | "failed" | "stale" | "error";
  errors: string[];
  verification?: VerificationRecord;
}

export interface WorkspaceCompletionReport { passed: boolean; modifiedFiles: string[]; errors: string[]; files: WorkspaceFileState[]; }
export type WorkspaceRead = (path: string) => Promise<string | undefined>;

/**
 * Authoritative, content-addressed state for one agent execution. The executor
 * must record every read and re-read after writes; completion only accepts a
 * successful verification bound to the current SHA-256 content hash.
 */
export class WorkspaceState {
  private readonly files = new Map<string, WorkspaceFileState>();
  constructor(private readonly read: WorkspaceRead) {}

  static hash(content: string): string { return createHash("sha256").update(content).digest("hex"); }
  private key(filePath: string): string { return filePath.replace(/\\/g, "/").replace(/^\.\//, ""); }
  private clone(state: WorkspaceFileState): WorkspaceFileState { return { ...state, errors: [...state.errors], verification: state.verification ? { ...state.verification, issues: [...state.verification.issues], allIssues: [...state.verification.allIssues] } : undefined }; }

  /** Records content returned by a guarded read skill without trusting a model snapshot. */
  observe(path: string, content: string, reason: "read" | "write" = "read"): WorkspaceFileState {
    const key = this.key(path); const previous = this.files.get(key); const contentHash = WorkspaceState.hash(content); const changed = !previous || previous.contentHash !== contentHash; const now = new Date().toISOString();
    const state: WorkspaceFileState = { path: key, exists: true, contentHash, previousHash: changed ? previous?.contentHash : previous?.previousHash, hash: contentHash, content, version: (previous?.version ?? 0) + (changed ? 1 : 0), readAt: now, writtenAt: reason === "write" ? now : previous?.writtenAt, verifiedHash: previous?.verifiedHash, verifiedAt: previous?.verifiedAt, status: reason === "write" ? "modified" : previous?.status === "verified" && previous.verifiedHash === contentHash ? "verified" : previous?.status === "failed" ? "failed" : previous?.status === "stale" ? "stale" : "read", errors: [...(previous?.errors ?? [])], verification: previous?.verification };
    if (previous?.verifiedHash && previous.verifiedHash !== contentHash) { state.status = "stale"; state.errors.push("La vérification précédente ne correspond plus au contenu courant."); }
    this.files.set(key, state); return this.clone(state);
  }

  async reread(path: string, reason: "read" | "write" = "read"): Promise<WorkspaceFileState> {
    try { const content = await this.read(path); if (typeof content !== "string") throw new Error("Lecture du fichier sans contenu."); return this.observe(path, content, reason); }
    catch (error) { const key = this.key(path); const previous = this.files.get(key); const state: WorkspaceFileState = { path: key, exists: false, contentHash: previous?.contentHash ?? "", previousHash: previous?.contentHash, hash: previous?.contentHash ?? "", content: previous?.content, version: previous?.version ?? 0, status: "error", errors: [...(previous?.errors ?? []), (error as Error).message], verification: previous?.verification }; this.files.set(key, state); return this.clone(state); }
  }

  markError(path: string, error: string): void {
    const key = this.key(path); const previous = this.files.get(key);
    const state: WorkspaceFileState = previous ? { ...previous, status: "error", errors: [...previous.errors, error] } : { path: key, exists: false, contentHash: "", hash: "", version: 0, status: "error", errors: [error] };
    this.files.set(key, state);
  }

  recordVerification(path: string, record: VerificationRecord): WorkspaceFileState {
    const key = this.key(path); const previous = this.files.get(key);
    if (!previous) throw new Error(`Le fichier ${key} doit être relu avant vérification.`);
    const fresh = record.status === "success" && record.ok && record.hashBefore === record.hashAfter && previous.contentHash === record.hashAfter;
    const errors = [...previous.errors];
    if (!fresh) errors.push(record.status === "stale" ? "La vérification a détecté un changement de contenu pendant les contrôles." : "Vérification absente, échouée ou obsolète pour le contenu courant.");
    if (!record.ok) errors.push(...record.allIssues.map((issue) => issue.message));
    const state: WorkspaceFileState = { ...previous, verifiedHash: record.hashAfter, verifiedAt: record.verifiedAt, verification: record, status: fresh ? "verified" : record.status === "stale" || previous.contentHash !== record.hashAfter ? "stale" : "failed", errors };
    this.files.set(key, state); return this.clone(state);
  }

  get(path: string): WorkspaceFileState | undefined { const state = this.files.get(this.key(path)); return state ? this.clone(state) : undefined; }

  completionReport(modifiedPaths: Iterable<string>): WorkspaceCompletionReport {
    const modified = [...new Set([...modifiedPaths].map((filePath) => this.key(filePath)))];
    const files = modified.map((filePath) => this.files.get(filePath) ?? { path: filePath, exists: false, contentHash: "", hash: "", version: 0, status: "error" as const, errors: ["État de fichier absent."] });
    const errors = files.flatMap((file) => file.status === "verified" && file.verifiedHash === file.contentHash && file.verification?.ok && file.verification.status === "success" ? [] : [`${file.path}: vérification actuelle réussie requise (status ${file.status}).`, ...file.errors.map((error) => `${file.path}: ${error}`)]);
    return { passed: errors.length === 0, modifiedFiles: modified, errors, files: files.map((file) => this.clone(file)) };
  }
}
