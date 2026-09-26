import { useState, useEffect, useCallback, useMemo, useRef, memo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X, ChevronRight, ChevronDown, ChevronUp, FileCode2, FilePlus2, FileX2,
  RefreshCcw, Loader2, Check, RotateCcw, CheckCheck, XCircle,
  ArrowLeft, Columns2, AlignJustify, Keyboard,
} from 'lucide-react';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface FileDiff {
  path: string;
  status: 'added' | 'modified' | 'deleted';
}

export interface DiffLine {
  type: 'unchanged' | 'added' | 'removed';
  content: string;
  lineNumOld?: number;
  lineNumNew?: number;
}

export type DiffMode = 'side-by-side' | 'unified';

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('Leanna_api_token');
  return token ? { 'x-Leanna-token': token } : {};
}

// Supprime les lignes vides au début et à la fin pour éviter les artefacts de diff
function trimEmptyLines(content: string): string {
  const lines = content.split('\n');
  let start = 0;
  let end = lines.length;

  // Supprime les lignes vides au début
  while (start < end && lines[start] === '') {
    start++;
  }

  // Supprime les lignes vides à la fin
  while (end > start && lines[end - 1] === '') {
    end--;
  }

  return lines.slice(start, end).join('\n');
}

function computeDiff(original: string, modified: string): DiffLine[] {
  const oldLines = original.split('\n');
  const newLines = modified.split('\n');
  const m = oldLines.length;
  const n = newLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const result: DiffLine[] = [];
  let i = m,
    j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.unshift({ type: 'unchanged', content: oldLines[i - 1], lineNumOld: i, lineNumNew: j });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: 'added', content: newLines[j - 1], lineNumNew: j });
      j--;
    } else {
      result.unshift({ type: 'removed', content: oldLines[i - 1], lineNumOld: i });
      i--;
    }
  }
  return result;
}

function computeWordDiff(oldText: string, newText: string): {
  oldSegments: Array<{ text: string; highlight: boolean }>;
  newSegments: Array<{ text: string; highlight: boolean }>;
} {
  const oldTokens = tokenize(oldText);
  const newTokens = tokenize(newText);

  const m = oldTokens.length;
  const n = newTokens.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldTokens[i - 1] === newTokens[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const oldMarks = new Array(m).fill(true);
  const newMarks = new Array(n).fill(true);
  let ii = m,
    jj = n;
  while (ii > 0 && jj > 0) {
    if (oldTokens[ii - 1] === newTokens[jj - 1]) {
      oldMarks[ii - 1] = false;
      newMarks[jj - 1] = false;
      ii--;
      jj--;
    } else if (dp[ii][jj - 1] >= dp[ii - 1][jj]) {
      jj--;
    } else {
      ii--;
    }
  }

  return {
    oldSegments: mergeSegments(oldTokens, oldMarks),
    newSegments: mergeSegments(newTokens, newMarks),
  };
}

function tokenize(text: string): string[] {
  // Amélioré : capture les mots, espaces, et caractères spéciaux séparément
  // pour une meilleure détection des petits changements
  const tokens = text.match(/(\S+)|(\s+)|([\n])/g) || [];
  // Fusionne les tokens consécutifs de même type (sauf newlines)
  const merged: string[] = [];
  for (const token of tokens) {
    const last = merged[merged.length - 1];
    // Fusionne avec le dernier token si même type (non-vide et pas newline)
    if (last && last !== '\n' && token !== '\n' && 
        ((/\S/.test(last) && /\S/.test(token)) || 
         (/\s/.test(last) && /\s/.test(token)))) {
      merged[merged.length - 1] = last + token;
    } else {
      merged.push(token);
    }
  }
  return merged.length > 0 ? merged : [''];
}

function mergeSegments(tokens: string[], marks: boolean[]): Array<{ text: string; highlight: boolean }> {
  const segments: Array<{ text: string; highlight: boolean }> = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    // Ignore les newlines isolés pour éviter les segments vides
    if (token === '\n') continue;
    
    const last = segments[segments.length - 1];
    if (last && last.highlight === marks[i]) {
      last.text += token;
    } else {
      segments.push({ text: token, highlight: marks[i] });
    }
  }
  return segments;
}

function highlightSyntax(text: string): Array<{ text: string; color: string }> {
  const spans: Array<{ text: string; color: string }> = [];
  const regex = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b(?:import|export|from|const|let|var|function|async|await|return|if|else|for|while|switch|case|break|continue|new|class|interface|type|extends|implements|throw|try|catch|finally|typeof|instanceof|in|of|default|void|null|undefined|true|false|this|super|static|abstract|readonly|private|protected|public|enum|namespace|module|declare|as|is|keyof|infer|never|unknown|any|number|string|boolean|object|symbol|bigint)\b)|(\/\/.*$)|(\/\*[\s\S]*?\*\/)|((?:0x[\da-f]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)(?:n)?)|([{}()[\];,.:?!<>=+\-*/%&|^~@#])/gm;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      spans.push({ text: text.slice(lastIndex, match.index), color: '' });
    }

    if (match[1]) {
      spans.push({ text: match[0], color: 'var(--color-success)' });
    } else if (match[2]) {
      spans.push({ text: match[0], color: 'var(--color-accent-alt)' });
    } else if (match[3] || match[4]) {
      spans.push({ text: match[0], color: 'var(--text-muted)' });
    } else if (match[5]) {
      spans.push({ text: match[0], color: 'var(--accent-primary)' });
    } else if (match[6]) {
      spans.push({ text: match[0], color: 'var(--text-muted)' });
    } else {
      spans.push({ text: match[0], color: '' });
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    spans.push({ text: text.slice(lastIndex), color: '' });
  }

  return spans.length > 0 ? spans : [{ text, color: '' }];
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════

const StatusBadge = memo(function StatusBadge({ status }: { status: FileDiff['status'] }) {
  const config = {
    added: { label: 'Ajouté', color: 'var(--color-success)', bg: 'rgba(74,222,128,0.1)' },
    modified: { label: 'Modifié', color: 'var(--color-warning)', bg: 'rgba(251,191,36,0.1)' },
    deleted: { label: 'Supprimé', color: 'var(--color-error)', bg: 'rgba(248,113,113,0.1)' },
  }[status];

  return (
    <span
      className="rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wider"
      style={{ color: config.color, backgroundColor: config.bg }}
    >
      {config.label}
    </span>
  );
});

const SyntaxLine = memo(function SyntaxLine({
  content,
  segments,
}: {
  content: string;
  segments?: Array<{ text: string; highlight: boolean }>;
}) {
  if (segments) {
    return (
      <>
        {segments.map((seg, i) =>
          seg.highlight ? (
            <mark
              key={i}
              className="rounded-sm px-[1px] py-[0px]"
              style={{
                backgroundColor: 'rgba(251, 191, 36, 0.5)',
                color: 'var(--text-primary)',
                textDecoration: 'none',
                borderRadius: '2px',
              }}
            >
              {seg.text}
            </mark>
          ) : (
            <SyntaxSpan key={i} text={seg.text} />
          )
        )}
      </>
    );
  }
  return <SyntaxSpan text={content} />;
});

const SyntaxSpan = memo(function SyntaxSpan({ text }: { text: string }) {
  const tokens = highlightSyntax(text);
  return (
    <>
      {tokens.map((tok, i) => (
        <span key={i} style={tok.color ? { color: tok.color } : undefined}>
          {tok.text}
        </span>
      ))}
    </>
  );
});

// ─── File List Sidebar ──────────────────────────────────────────────────────

const FileList = memo(function FileList({
  files,
  selectedPath,
  onSelect,
  loading,
}: {
  files: FileDiff[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
  loading: boolean;
}) {
  return (
    <div
      className="w-64 flex-shrink-0 overflow-y-auto custom-scrollbar lg:w-72"
      style={{ borderRight: '1px solid var(--border-base)', backgroundColor: 'var(--bg-secondary)' }}
    >
      {loading ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 size={18} className="animate-spin" style={{ color: 'var(--text-muted)' }} />
        </div>
      ) : files.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-32 gap-2">
          <FileCode2 size={20} style={{ color: 'var(--text-dimmed)' }} />
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Aucune modification
          </p>
        </div>
      ) : (
        <div className="py-2">
          {files.map((file) => {
            const isSelected = selectedPath === file.path;
            const Icon = file.status === 'added' ? FilePlus2 : file.status === 'deleted' ? FileX2 : FileCode2;
            const iconColor = file.status === 'added' ? 'var(--color-success)' : file.status === 'deleted' ? 'var(--color-error)' : 'var(--color-warning)';

            return (
              <button
                key={file.path}
                onClick={() => onSelect(file.path)}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors group"
                style={{
                  backgroundColor: isSelected ? 'var(--bg-input)' : 'transparent',
                  borderLeft: isSelected ? `2px solid ${iconColor}` : '2px solid transparent',
                }}
              >
                <Icon size={13} style={{ color: iconColor, flexShrink: 0 }} />
                <div className="flex-1 min-w-0">
                  <span
                    className="text-sm font-medium truncate block"
                    style={{ color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)' }}
                  >
                    {file.path.split('/').pop()}
                  </span>
                  <span
                    className="text-xs truncate block opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ color: 'var(--text-dimmed)' }}
                  >
                    {file.path}
                  </span>
                </div>
                <span
                  className="hidden shrink-0 text-[10px] font-medium uppercase tracking-wide sm:block"
                  style={{ color: iconColor }}
                >
                  {file.status === 'added' ? 'Ajouté' : file.status === 'deleted' ? 'Supprimé' : 'Modifié'}
                </span>
                {isSelected && <ChevronRight size={11} style={{ color: 'var(--text-dimmed)' }} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

interface SandboxDiffViewerProps {
  onClose: () => void;
  initialSelectedFile?: string | null;
  embedded?: boolean;
}

export function SandboxDiffViewer({ onClose, initialSelectedFile, embedded = false }: SandboxDiffViewerProps) {
  // ─── State ───────────────────────────────────────────────────────────────────

  const [files, setFiles] = useState<FileDiff[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFile, setSelectedFile] = useState<string | null>(initialSelectedFile ?? null);
  const [originalContent, setOriginalContent] = useState<string | null>(null);
  const [modifiedContent, setModifiedContent] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [diffMode, setDiffMode] = useState<DiffMode>('side-by-side');
  const [showShortcuts, setShowShortcuts] = useState(false);

  // ─── Refs for scrolling ─────────────────────────────────────────────────────

  const leftScrollRef = useRef<HTMLDivElement>(null);
  const rightScrollRef = useRef<HTMLDivElement>(null);
  const unifiedScrollRef = useRef<HTMLDivElement>(null);
  const isScrolling = useRef(false);

  // ─── Chunk navigation ──────────────────────────────────────────────────────

  const [currentChunkIdx, setCurrentChunkIdx] = useState(0);

  // ─── Load file list ────────────────────────────────────────────────────────

  const loadDiffs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/sandbox/diff', { headers: getAuthHeaders() });
      const data = await res.json();
      if (data.status === 'success') {
        setFiles(data.diffs || []);
        if (data.diffs?.length > 0 && !selectedFile) {
          setSelectedFile(data.diffs[0].path);
        }
      }
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }, [selectedFile]);

  useEffect(() => {
    loadDiffs();
  }, [loadDiffs]);

  // ─── Load file content ─────────────────────────────────────────────────────

  const loadFileContent = useCallback(
    async (filePath: string) => {
      setFileLoading(true);
      setOriginalContent(null);
      setModifiedContent(null);
      try {
        const res = await fetch(`/api/sandbox/file-diff?path=${encodeURIComponent(filePath)}`, {
          headers: getAuthHeaders(),
        });
        const data = await res.json();
        if (data.status === 'success') {
          // Nettoie les lignes vides au début/fin pour éviter les artefacts de diff
          setOriginalContent(trimEmptyLines(data.original ?? ''));
          setModifiedContent(trimEmptyLines(data.modified ?? ''));
        }
      } catch {
        /* silent */
      } finally {
        setFileLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (selectedFile) {
      loadFileContent(selectedFile);
      setCurrentChunkIdx(0);
    }
  }, [selectedFile, loadFileContent]);

  // ─── Accept / Reject file ──────────────────────────────────────────────────

  const handleAcceptFile = useCallback(
    async (filePath: string) => {
      setActionBusy(filePath);
      setFeedback(null);
      try {
        const res = await fetch('/api/sandbox/accept-file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify({ path: filePath }),
        });
        const data = await res.json();
        if (res.ok && data.status === 'success' && data.applied === true) {
          setFeedback({ type: 'success', msg: `${filePath.split('/').pop()} appliqué au projet` });
          setSelectedFile(null);
          window.dispatchEvent(new CustomEvent('Leanna-sandbox-changed'));
          await loadDiffs();
        } else {
          setFeedback({ type: 'error', msg: data.error || 'Le fichier n’a pas pu être appliqué' });
        }
      } catch {
        setFeedback({ type: 'error', msg: 'Erreur réseau' });
      } finally {
        setActionBusy(null);
      }
    },
    [loadDiffs]
  );

  const handleRejectFile = useCallback(
    async (filePath: string) => {
      setActionBusy(filePath);
      setFeedback(null);
      try {
        const res = await fetch('/api/sandbox/reject-file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify({ path: filePath }),
        });
        const data = await res.json();
        if (res.ok && data.status === 'success' && data.reverted === true) {
          setFeedback({ type: 'success', msg: `${filePath.split('/').pop()} rejeté` });
          setSelectedFile(null);
          window.dispatchEvent(new CustomEvent('Leanna-sandbox-changed'));
          await loadDiffs();
        } else {
          setFeedback({ type: 'error', msg: data.error || 'Le fichier n’a pas pu être rejeté' });
        }
      } catch {
        setFeedback({ type: 'error', msg: 'Erreur réseau' });
      } finally {
        setActionBusy(null);
      }
    },
    [loadDiffs]
  );

  // ─── Accept / Reject ALL ──────────────────────────────────────────────────

  const handleAcceptAll = useCallback(async () => {
    setActionBusy('all');
    setFeedback(null);
    try {
      const res = await fetch('/api/sandbox/sync', {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (data.status === 'success') {
        setFeedback({ type: 'success', msg: `${files.length} fichier(s) appliqué(s)` });
        setFiles([]);
        setSelectedFile(null);
        window.dispatchEvent(new CustomEvent('Leanna-sandbox-changed'));
      } else if (data.status === 'validation_failed') {
        const errCount = data.errorCount || 0;
        const warnCount = data.warningCount || 0;
        setFeedback({ type: 'error', msg: `Validation échouée : ${errCount} erreur(s), ${warnCount} avertissement(s). Corrigez les erreurs avant de synchroniser.` });
      } else {
        setFeedback({ type: 'error', msg: data.error || 'Erreur lors de la synchronisation' });
      }
    } catch {
      setFeedback({ type: 'error', msg: 'Erreur réseau' });
    } finally {
      setActionBusy(null);
    }
  }, [files.length]);

  const handleRejectAll = useCallback(async () => {
    setActionBusy('all');
    setFeedback(null);
    try {
      const res = await fetch('/api/sandbox/discard', {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (res.ok && data.status === 'success') {
        setFeedback({ type: 'success', msg: 'Toutes les modifications rejetées' });
        setFiles([]);
        setSelectedFile(null);
        window.dispatchEvent(new CustomEvent('Leanna-sandbox-changed'));
      } else {
        setFeedback({ type: 'error', msg: data.error || 'Erreur lors de l\'abandon des modifications' });
      }
    } catch {
      setFeedback({ type: 'error', msg: 'Erreur réseau' });
    } finally {
      setActionBusy(null);
    }
  }, []);

  // ─── Compute diff lines ────────────────────────────────────────────────────

  const diffLines = useMemo(() => {
    if (originalContent === null || modifiedContent === null) return [];
    return computeDiff(originalContent, modifiedContent);
  }, [originalContent, modifiedContent]);

  // ─── Word diff map ─────────────────────────────────────────────────────────

  const wordDiffMap = useMemo(() => {
    const map = new Map<
      number,
      { oldSegments: Array<{ text: string; highlight: boolean }>; newSegments: Array<{ text: string; highlight: boolean }> }
    >();
    for (let i = 0; i < diffLines.length - 1; i++) {
      if (diffLines[i].type === 'removed' && diffLines[i + 1].type === 'added') {
        const result = computeWordDiff(diffLines[i].content, diffLines[i + 1].content);
        map.set(i, result);
      }
    }
    return map;
  }, [diffLines]);

  // ─── Side-by-side lines ────────────────────────────────────────────────────

  const { leftLines, rightLines } = useMemo(() => {
    const left: Array<{
      num?: number;
      content: string;
      type: DiffLine['type'];
      wordSegments?: Array<{ text: string; highlight: boolean }>;
    }> = [];
    const right: Array<{
      num?: number;
      content: string;
      type: DiffLine['type'];
      wordSegments?: Array<{ text: string; highlight: boolean }>;
    }> = [];

    for (let i = 0; i < diffLines.length; i++) {
      const line = diffLines[i];
      const wordDiff = wordDiffMap.get(i);

      if (line.type === 'unchanged') {
        left.push({ num: line.lineNumOld, content: line.content, type: 'unchanged' });
        right.push({ num: line.lineNumNew, content: line.content, type: 'unchanged' });
      } else if (line.type === 'removed') {
        if (wordDiff) {
          left.push({ num: line.lineNumOld, content: line.content, type: 'removed', wordSegments: wordDiff.oldSegments });
          right.push({
            num: diffLines[i + 1].lineNumNew,
            content: diffLines[i + 1].content,
            type: 'added',
            wordSegments: wordDiff.newSegments,
          });
          i++; // skip next added
        } else {
          left.push({ num: line.lineNumOld, content: line.content, type: 'removed' });
          right.push({ content: '', type: 'unchanged' });
        }
      } else if (line.type === 'added') {
        left.push({ content: '', type: 'unchanged' });
        right.push({ num: line.lineNumNew, content: line.content, type: 'added' });
      }
    }
    return { leftLines: left, rightLines: right };
  }, [diffLines, wordDiffMap]);

  // ─── Chunk indices ─────────────────────────────────────────────────────────

  const chunkIndices = useMemo(() => {
    const indices: number[] = [];
    let inChunk = false;
    for (let i = 0; i < leftLines.length; i++) {
      const isChange = leftLines[i].type !== 'unchanged' || rightLines[i].type !== 'unchanged';
      if (isChange && !inChunk) {
        indices.push(i);
        inChunk = true;
      } else if (!isChange) {
        inChunk = false;
      }
    }
    return indices;
  }, [leftLines, rightLines]);

  const unifiedChunkIndices = useMemo(() => {
    const indices: number[] = [];
    let inChunk = false;
    for (let i = 0; i < diffLines.length; i++) {
      if (diffLines[i].type !== 'unchanged' && !inChunk) {
        indices.push(i);
        inChunk = true;
      } else if (diffLines[i].type === 'unchanged') {
        inChunk = false;
      }
    }
    return indices;
  }, [diffLines]);

  const totalChunks = diffMode === 'side-by-side' ? chunkIndices.length : unifiedChunkIndices.length;

  // ─── Navigation ────────────────────────────────────────────────────────────

  const navigateToChunk = useCallback(
    (idx: number) => {
      const indices = diffMode === 'side-by-side' ? chunkIndices : unifiedChunkIndices;
      if (idx < 0 || idx >= indices.length) return;
      setCurrentChunkIdx(idx);

      const lineIdx = indices[idx];
      const lineHeight = 20;
      const scrollTop = lineIdx * lineHeight - 60;

      if (diffMode === 'side-by-side') {
        if (leftScrollRef.current) leftScrollRef.current.scrollTop = scrollTop;
        if (rightScrollRef.current) rightScrollRef.current.scrollTop = scrollTop;
      } else {
        if (unifiedScrollRef.current) unifiedScrollRef.current.scrollTop = scrollTop;
      }
    },
    [diffMode, chunkIndices, unifiedChunkIndices]
  );

  const goNextChunk = useCallback(() => {
    navigateToChunk(Math.min(currentChunkIdx + 1, totalChunks - 1));
  }, [currentChunkIdx, totalChunks, navigateToChunk]);

  const goPrevChunk = useCallback(() => {
    navigateToChunk(Math.max(currentChunkIdx - 1, 0));
  }, [currentChunkIdx, navigateToChunk]);

  // ─── File navigation ──────────────────────────────────────────────────────

  const selectNextFile = useCallback(() => {
    if (!selectedFile || files.length === 0) return;
    const idx = files.findIndex((f) => f.path === selectedFile);
    if (idx < files.length - 1) setSelectedFile(files[idx + 1].path);
  }, [selectedFile, files]);

  const selectPrevFile = useCallback(() => {
    if (!selectedFile || files.length === 0) return;
    const idx = files.findIndex((f) => f.path === selectedFile);
    if (idx > 0) setSelectedFile(files[idx - 1].path);
  }, [selectedFile, files]);

  // ─── Synchronized scrolling ──────────────────────────────────────────────

  const handleScroll = useCallback(
    (source: 'left' | 'right') => {
      if (isScrolling.current) return;
      isScrolling.current = true;

      const sourceEl = source === 'left' ? leftScrollRef.current : rightScrollRef.current;
      const targetEl = source === 'left' ? rightScrollRef.current : leftScrollRef.current;

      if (sourceEl && targetEl) {
        targetEl.scrollTop = sourceEl.scrollTop;
      }

      requestAnimationFrame(() => {
        isScrolling.current = false;
      });
    },
    []
  );

  // ─── Keyboard shortcuts ───────────────────────────────────────────────────

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;

      switch (e.key) {
        case 'Escape':
          onClose();
          break;
        case 'a':
        case 'A':
          if (selectedFile && !actionBusy) handleAcceptFile(selectedFile);
          break;
        case 'r':
        case 'R':
          if (selectedFile && !actionBusy) handleRejectFile(selectedFile);
          break;
        case 'n':
        case 'N':
          goNextChunk();
          break;
        case 'p':
        case 'P':
          goPrevChunk();
          break;
        case 'ArrowDown':
          if (e.ctrlKey || e.metaKey) {
            selectNextFile();
            e.preventDefault();
          }
          break;
        case 'ArrowUp':
          if (e.ctrlKey || e.metaKey) {
            selectPrevFile();
            e.preventDefault();
          }
          break;
        case 'm':
        case 'M':
          setDiffMode((prev) => (prev === 'side-by-side' ? 'unified' : 'side-by-side'));
          break;
        case '?':
          setShowShortcuts((prev) => !prev);
          break;
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [
    onClose,
    selectedFile,
    actionBusy,
    handleAcceptFile,
    handleRejectFile,
    goNextChunk,
    goPrevChunk,
    selectNextFile,
    selectPrevFile,
  ]);

  // ─── Clear feedback ───────────────────────────────────────────────────────

  useEffect(() => {
    if (!feedback) return;
    const t = setTimeout(() => setFeedback(null), 4000);
    return () => clearTimeout(t);
  }, [feedback]);

  // ─── Stats ─────────────────────────────────────────────────────────────────

  const stats = useMemo(() => {
    let added = 0,
      removed = 0;
    for (const l of diffLines) {
      if (l.type === 'added') added++;
      if (l.type === 'removed') removed++;
    }
    return { added, removed };
  }, [diffLines]);

  const selectedFileStatus = files.find((f) => f.path === selectedFile)?.status;
  const isBusy = actionBusy !== null;

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className={embedded ? 'relative flex flex-1 min-h-0 flex-col' : 'fixed inset-0 z-50 flex flex-col'}
      style={{ backgroundColor: 'var(--bg-base)' }}
    >
      {/* ─── Header ────────────────────────────────────────────────────────── */}
      <div
        className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border-base)', backgroundColor: 'var(--bg-panel)' }}
      >
        <div className="flex min-w-0 items-center gap-3">
          <h2 className="truncate text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
            {embedded ? 'Comparer les modifications' : 'Modifications Sandbox'}
          </h2>
          <span
            className="text-sm font-medium rounded-full px-2.5 py-0.5"
            style={{ backgroundColor: 'var(--bg-input)', color: 'var(--text-muted)' }}
          >
            {files.length} fichier{files.length > 1 ? 's' : ''}
          </span>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {/* Mode toggle */}
          <button
            onClick={() => setDiffMode((prev) => (prev === 'side-by-side' ? 'unified' : 'side-by-side'))}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all hover:bg-white/5"
            style={{ color: 'var(--text-muted)', border: '1px solid var(--border-base)' }}
            title={`Mode: ${diffMode === 'side-by-side' ? 'Côte à côte' : 'Unifié'} (M)`}
          >
            {diffMode === 'side-by-side' ? <Columns2 size={12} /> : <AlignJustify size={12} />}
            {diffMode === 'side-by-side' ? 'Split' : 'Unifié'}
          </button>

          {/* Chunk navigation */}
          {totalChunks > 0 && (
            <div className="flex items-center gap-1 rounded-lg px-1" style={{ border: '1px solid var(--border-base)' }}>
              <button
                onClick={goPrevChunk}
                disabled={currentChunkIdx === 0}
                className="p-1.5 rounded hover:bg-white/5 transition disabled:opacity-30"
                title="Changement précédent (P)"
              >
                <ChevronUp size={12} style={{ color: 'var(--text-muted)' }} />
              </button>
              <span className="text-xs font-mono tabular-nums px-1" style={{ color: 'var(--text-muted)' }}>
                {currentChunkIdx + 1}/{totalChunks}
              </span>
              <button
                onClick={goNextChunk}
                disabled={currentChunkIdx >= totalChunks - 1}
                className="p-1.5 rounded hover:bg-white/5 transition disabled:opacity-30"
                title="Changement suivant (N)"
              >
                <ChevronDown size={12} style={{ color: 'var(--text-muted)' }} />
              </button>
            </div>
          )}

          {/* Accept all */}
          {files.length > 1 && (
            <button
              onClick={handleAcceptAll}
              disabled={isBusy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all disabled:opacity-50"
              style={{
                backgroundColor: 'rgba(74,222,128,0.1)',
                color: 'var(--color-success)',
                border: '1px solid rgba(74,222,128,0.2)',
              }}
              title="Accepter toutes les modifications"
            >
              <CheckCheck size={12} /> <span className="hidden sm:inline">Tout accepter</span>
            </button>
          )}
          {files.length > 1 && (
            <button
              onClick={handleRejectAll}
              disabled={isBusy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all disabled:opacity-50"
              style={{
                backgroundColor: 'rgba(248,113,113,0.1)',
                color: 'var(--color-error)',
                border: '1px solid rgba(248,113,113,0.2)',
              }}
              title="Rejeter toutes les modifications"
            >
              <XCircle size={12} /> <span className="hidden sm:inline">Tout rejeter</span>
            </button>
          )}

          <button
            onClick={loadDiffs}
            className="p-2 rounded-lg transition-colors hover:bg-white/5"
            title="Rafraîchir"
          >
            <RefreshCcw size={14} style={{ color: 'var(--text-muted)' }} />
          </button>
          <button
            onClick={() => setShowShortcuts((prev) => !prev)}
            className="p-2 rounded-lg transition-colors hover:bg-white/5"
            title="Raccourcis clavier (?)"
          >
            <Keyboard size={14} style={{ color: 'var(--text-muted)' }} />
          </button>
          <button
            onClick={onClose}
            className="p-2 rounded-lg transition-colors hover:bg-white/5"
            title={embedded ? 'Retour aux contrôles du sandbox (Escape)' : 'Fermer (Escape)'}
            aria-label={embedded ? 'Retour aux contrôles du sandbox' : 'Fermer'}
          >
            {embedded ? <ArrowLeft size={16} style={{ color: 'var(--text-muted)' }} /> : <X size={16} style={{ color: 'var(--text-muted)' }} />}
          </button>
        </div>
      </div>

      {/* ─── Shortcuts overlay ────────────────────────────────────────────── */}
      <AnimatePresence>
        {showShortcuts && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="absolute top-14 right-4 z-50 rounded-xl p-4 shadow-xl"
            style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-base)' }}
          >
            <p className="text-sm font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
              Raccourcis clavier
            </p>
            <div className="space-y-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
              <div className="flex justify-between gap-6">
                <span>Accepter fichier</span>
                <kbd className="font-mono px-1.5 py-0.5 rounded bg-white/5">A</kbd>
              </div>
              <div className="flex justify-between gap-6">
                <span>Rejeter fichier</span>
                <kbd className="font-mono px-1.5 py-0.5 rounded bg-white/5">R</kbd>
              </div>
              <div className="flex justify-between gap-6">
                <span>Changement suivant</span>
                <kbd className="font-mono px-1.5 py-0.5 rounded bg-white/5">N</kbd>
              </div>
              <div className="flex justify-between gap-6">
                <span>Changement précédent</span>
                <kbd className="font-mono px-1.5 py-0.5 rounded bg-white/5">P</kbd>
              </div>
              <div className="flex justify-between gap-6">
                <span>Fichier suivant</span>
                <kbd className="font-mono px-1.5 py-0.5 rounded bg-white/5">Ctrl+↓</kbd>
              </div>
              <div className="flex justify-between gap-6">
                <span>Fichier précédent</span>
                <kbd className="font-mono px-1.5 py-0.5 rounded bg-white/5">Ctrl+↑</kbd>
              </div>
              <div className="flex justify-between gap-6">
                <span>Basculer mode</span>
                <kbd className="font-mono px-1.5 py-0.5 rounded bg-white/5">M</kbd>
              </div>
              <div className="flex justify-between gap-6">
                <span>Fermer</span>
                <kbd className="font-mono px-1.5 py-0.5 rounded bg-white/5">Esc</kbd>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Feedback toast ────────────────────────────────────────────────── */}
      <AnimatePresence>
        {feedback && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="absolute top-14 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2 rounded-lg"
            style={{
              backgroundColor:
                feedback.type === 'success' ? 'rgba(74,222,128,0.12)' : 'rgba(248,113,113,0.12)',
              border: `1px solid ${feedback.type === 'success' ? 'rgba(74,222,128,0.3)' : 'rgba(248,113,113,0.3)'}`,
              color: feedback.type === 'success' ? 'var(--color-success)' : 'var(--color-error)',
            }}
          >
            {feedback.type === 'success' ? <Check size={13} /> : <XCircle size={13} />}
            <span className="text-sm font-medium">{feedback.msg}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Body ───────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0">
        <FileList
          files={files}
          selectedPath={selectedFile}
          onSelect={setSelectedFile}
          loading={loading}
        />

        <div className="flex-1 flex flex-col min-w-0">
          {/* File info bar */}
          {selectedFile && (
            <div
              className="flex items-center gap-3 px-4 py-2 flex-shrink-0"
              style={{ borderBottom: '1px solid var(--border-base)', backgroundColor: 'rgba(0,0,0,0.15)' }}
            >
              <span className="text-sm font-mono" style={{ color: 'var(--text-muted)' }}>
                {selectedFile}
              </span>
              {selectedFileStatus && <StatusBadge status={selectedFileStatus} />}
              {stats.added > 0 && (
                <span className="text-xs font-mono font-medium" style={{ color: 'var(--color-success)' }}>
                  +{stats.added}
                </span>
              )}
              {stats.removed > 0 && (
                <span className="text-xs font-mono font-medium" style={{ color: 'var(--color-error)' }}>
                  -{stats.removed}
                </span>
              )}

              <div className="ml-auto flex items-center gap-2">
                <button
                  onClick={() => selectedFile && handleAcceptFile(selectedFile)}
                  disabled={isBusy}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition-all disabled:opacity-50 hover:brightness-110"
                  style={{
                    backgroundColor: 'rgba(74,222,128,0.12)',
                    color: 'var(--color-success)',
                    border: '1px solid rgba(74,222,128,0.25)',
                  }}
                  title="Accepter ce fichier (A)"
                >
                  {actionBusy === selectedFile ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                  Accepter
                </button>
                <button
                  onClick={() => selectedFile && handleRejectFile(selectedFile)}
                  disabled={isBusy}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition-all disabled:opacity-50 hover:brightness-110"
                  style={{
                    backgroundColor: 'rgba(248,113,113,0.12)',
                    color: 'var(--color-error)',
                    border: '1px solid rgba(248,113,113,0.25)',
                  }}
                  title="Rejeter ce fichier (R)"
                >
                  {actionBusy === selectedFile ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                  Rejeter
                </button>
              </div>
            </div>
          )}

          {/* Diff content */}
          {fileLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 size={20} className="animate-spin" style={{ color: 'var(--text-muted)' }} />
            </div>
          ) : !selectedFile ? (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-sm" style={{ color: 'var(--text-dimmed)' }}>
                Sélectionnez un fichier pour voir les modifications
              </p>
            </div>
          ) : diffMode === 'side-by-side' ? (
            /* ─── Side-by-side mode ─── */
            <div className="flex-1 flex min-h-0">
              <div
                className="flex-1 flex flex-col min-w-0"
                style={{ borderRight: '1px solid var(--border-base)' }}
              >
                <div
                  className="px-3 py-1.5 flex-shrink-0"
                  style={{ backgroundColor: 'rgba(220,38,38,0.08)', borderBottom: '1px solid var(--border-base)' }}
                >
                  <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-error)' }}>
                    Avant (Original)
                  </span>
                </div>
                <div
                  ref={leftScrollRef}
                  onScroll={() => handleScroll('left')}
                  className="flex-1 overflow-auto custom-scrollbar font-mono text-sm leading-[20px]"
                >
                  {leftLines.map((line, idx) => (
                    <div
                      key={idx}
                      className="flex"
                      style={{
                        backgroundColor: line.type === 'removed' ? 'rgba(220,38,38,0.12)' : 'transparent',
                        minHeight: 20,
                      }}
                    >
                      <span
                        className="inline-block w-10 text-right pr-3 select-none flex-shrink-0"
                        style={{
                          color: line.type === 'removed' ? 'rgba(220,38,38,0.7)' : 'var(--text-dimmed)',
                          backgroundColor: line.type === 'removed' ? 'rgba(220,38,38,0.06)' : 'transparent',
                        }}
                      >
                        {line.num ?? ''}
                      </span>
                      <span className="flex-1 whitespace-pre pr-4" style={{ color: line.type === 'removed' ? 'var(--color-error)' : 'var(--text-primary)' }}>
                        <SyntaxLine content={line.content} segments={line.wordSegments} />
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex-1 flex flex-col min-w-0">
                <div
                  className="px-3 py-1.5 flex-shrink-0"
                  style={{ backgroundColor: 'rgba(22,163,74,0.08)', borderBottom: '1px solid var(--border-base)' }}
                >
                  <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-success)' }}>
                    Après (Sandbox)
                  </span>
                </div>
                <div
                  ref={rightScrollRef}
                  onScroll={() => handleScroll('right')}
                  className="flex-1 overflow-auto custom-scrollbar font-mono text-sm leading-[20px]"
                >
                  {rightLines.map((line, idx) => (
                    <div
                      key={idx}
                      className="flex"
                      style={{
                        backgroundColor: line.type === 'added' ? 'rgba(22,163,74,0.12)' : 'transparent',
                        minHeight: 20,
                      }}
                    >
                      <span
                        className="inline-block w-10 text-right pr-3 select-none flex-shrink-0"
                        style={{
                          color: line.type === 'added' ? 'rgba(22,163,74,0.7)' : 'var(--text-dimmed)',
                          backgroundColor: line.type === 'added' ? 'rgba(22,163,74,0.06)' : 'transparent',
                        }}
                      >
                        {line.num ?? ''}
                      </span>
                      <span className="flex-1 whitespace-pre pr-4" style={{ color: line.type === 'added' ? 'var(--color-success)' : 'var(--text-primary)' }}>
                        <SyntaxLine content={line.content} segments={line.wordSegments} />
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            /* ─── Unified mode ─── */
            <div
              ref={unifiedScrollRef}
              className="flex-1 overflow-auto custom-scrollbar font-mono text-sm leading-[20px]"
            >
              {diffLines.map((line, idx) => {
                const prefix = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';
                const bgColor =
                  line.type === 'added'
                    ? 'rgba(22,163,74,0.12)'
                    : line.type === 'removed'
                    ? 'rgba(220,38,38,0.12)'
                    : 'transparent';
                const textColor =
                  line.type === 'added' ? 'var(--color-success)' : line.type === 'removed' ? 'var(--color-error)' : 'var(--text-primary)';
                const numColor =
                  line.type === 'added'
                    ? 'rgba(22,163,74,0.7)'
                    : line.type === 'removed'
                    ? 'rgba(220,38,38,0.7)'
                    : 'var(--text-dimmed)';

                let wordSegs: Array<{ text: string; highlight: boolean }> | undefined;
                const wordDiff = wordDiffMap.get(idx);
                if (wordDiff && line.type === 'removed') {
                  wordSegs = wordDiff.oldSegments;
                } else if (idx > 0 && wordDiffMap.has(idx - 1) && line.type === 'added') {
                  wordSegs = wordDiffMap.get(idx - 1)!.newSegments;
                }

                return (
                  <div key={idx} className="flex" style={{ backgroundColor: bgColor, minHeight: 20 }}>
                    <span
                      className="inline-block w-10 text-right pr-2 select-none flex-shrink-0"
                      style={{ color: numColor }}
                    >
                      {line.lineNumOld ?? ''}
                    </span>
                    <span
                      className="inline-block w-10 text-right pr-2 select-none flex-shrink-0"
                      style={{ color: numColor }}
                    >
                      {line.lineNumNew ?? ''}
                    </span>
                    <span
                      className="inline-block w-4 text-center select-none flex-shrink-0 font-bold"
                      style={{ color: textColor }}
                    >
                      {prefix}
                    </span>
                    <span className="flex-1 whitespace-pre pr-4" style={{ color: textColor }}>
                      <SyntaxLine content={line.content} segments={wordSegs} />
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ─── Footer legend ────────────────────────────────────────────────── */}
      <div
        className="flex items-center gap-6 px-4 py-2 flex-shrink-0"
        style={{ borderTop: '1px solid var(--border-base)', backgroundColor: 'var(--bg-panel)' }}
      >
        <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
          <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: 'rgba(220,38,38,0.25)' }} />
          Supprimé
        </span>
        <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
          <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: 'rgba(22,163,74,0.25)' }} />
          Ajouté
        </span>
        <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
          <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: 'rgba(251,191,36,0.5)' }} />
          Mot modifié
        </span>
        <span className="ml-auto text-xs" style={{ color: 'var(--text-dimmed)' }}>
          ? pour les raccourcis • {diffMode === 'side-by-side' ? 'Gauche: original • Droite: sandbox' : 'Diff unifié'}
        </span>
      </div>
    </motion.div>
  );
}