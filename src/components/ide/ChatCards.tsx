import { useState } from 'react';
import { motion } from 'motion/react';
import {
  FileText, Terminal, GitBranch, Package, Eye, Check, X,
  ChevronDown, ChevronRight, Copy,
} from 'lucide-react';

// ── Styles Communs ──────────────────────────────────────────────────────────
const cardStyles = {
  border: '1px solid var(--border-base)',
  background: 'rgba(255, 255, 255, 0.02)',
  transition: 'all 0.2s ease',
};

const textStyles = {
  primary: 'var(--text-primary)',
  dimmed: 'var(--text-dimmed)',
  muted: 'var(--text-muted)',
  accent: 'var(--accent-primary)',
};

const actionColors = {
  created: 'var(--color-success)',
  modified: 'var(--color-warning)',
  deleted: 'var(--color-error)',
  read: 'var(--accent-primary)',
  install: 'var(--color-success)',
  update: 'var(--color-warning)',
  remove: 'var(--color-error)',
  success: 'var(--color-success)',
  error: 'var(--color-error)',
};

const badgeStyles = (color: string) => ({
  backgroundColor: `${color}15`,
  color,
  fontSize: '8px',
  fontWeight: 600,
  textTransform: 'uppercase',
  padding: '2px 6px',
  borderRadius: '4px',
  letterSpacing: '0.5px',
});

// ── File Card ──────────────────────────────────────────────────────────────
interface FileCardProps {
  path: string;
  action: 'created' | 'modified' | 'deleted' | 'read';
  linesAdded?: number;
  linesRemoved?: number;
  onClick?: () => void;
}

export function FileCard({ path, action, linesAdded, linesRemoved, onClick }: FileCardProps) {
  const fileName = path.split(/[/\\]/).pop() || path;
  const dir = path.split(/[/\\]/).slice(-3, -1).join('/');
  const actionLabels = { created: 'Créé', modified: 'Modifié', deleted: 'Supprimé', read: 'Lu' };

  return (
    <motion.button
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-left group
                 hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-accent-primary/20"
      style={cardStyles}
    >
      <FileText
        size={16}
        style={{ color: actionColors[action], flexShrink: 0 }}
      />
      <div className="flex-1 min-w-0">
        <span
          className="text-sm font-medium block truncate"
          style={{ color: textStyles.primary }}
        >
          {fileName}
        </span>
        {dir && (
          <span
            className="text-sm mt-0.5 block truncate"
            style={{ color: textStyles.dimmed }}
          >
            {dir}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {typeof linesAdded === 'number' && linesAdded > 0 && (
          <span
            className="text-sm font-mono"
            style={{ color: actionColors.created }}
          >
            +{linesAdded}
          </span>
        )}
        {typeof linesRemoved === 'number' && linesRemoved > 0 && (
          <span
            className="text-sm font-mono"
            style={{ color: actionColors.deleted }}
          >
            -{linesRemoved}
          </span>
        )}
        <span className="text-xs font-semibold uppercase px-2 py-0.5 rounded-full" style={badgeStyles(actionColors[action])}>
          {actionLabels[action]}
        </span>
      </div>
    </motion.button>
  );
}

// ── Command Card ───────────────────────────────────────────────────────────
interface CommandCardProps {
  command: string;
  output?: string;
  exitCode?: number;
  onCopy?: () => void;
}

export function CommandCard({ command, output, exitCode, onCopy }: CommandCardProps) {
  const [expanded, setExpanded] = useState(false);
  const success = exitCode === 0 || exitCode === undefined;

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl overflow-hidden"
      style={cardStyles}
    >
      <div
        className="flex items-center gap-3 px-4 py-2.5 cursor-pointer
                   hover:bg-white/5 transition-colors"
        style={{ backgroundColor: 'rgba(255, 255, 255, 0.02)' }}
        onClick={() => output && setExpanded((v) => !v)}
      >
        <Terminal
          size={14}
          style={{ color: success ? actionColors.success : actionColors.error, flexShrink: 0 }}
        />
        <code
          className="text-xs font-mono flex-1 truncate"
          style={{ color: textStyles.primary }}
        >
          {command}
        </code>
        {exitCode !== undefined && (
          <span
            className="text-xs font-mono px-2 py-0.5 rounded-full"
            style={badgeStyles(success ? actionColors.success : actionColors.error)}
          >
            {success ? '✓' : `exit ${exitCode}`}
          </span>
        )}
        <div className="flex items-center gap-1 flex-shrink-0">
          {onCopy && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCopy();
              }}
              className="p-1.5 rounded-lg hover:bg-white/10 transition-colors
                         focus:outline-none focus:ring-1 focus:ring-white/20"
              aria-label="Copier la commande"
            >
              <Copy size={12} style={{ color: textStyles.muted }} />
            </button>
          )}
          {output && (
            expanded ? (
              <ChevronDown size={12} style={{ color: textStyles.dimmed }} />
            ) : (
              <ChevronRight size={12} style={{ color: textStyles.dimmed }} />
            )
          )}
        </div>
      </div>

      {expanded && output && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="px-4 py-2 border-t max-h-40 overflow-y-auto"
          style={{ borderColor: 'var(--border-base)', backgroundColor: 'rgba(0, 0, 0, 0.15)' }}
        >
          <pre
            className="text-sm font-mono whitespace-pre-wrap"
            style={{ color: textStyles.muted, margin: 0 }}
          >
            {output}
          </pre>
        </motion.div>
      )}
    </motion.div>
  );
}

// ── Diff Card ───────────────────────────────────────────────────────────────
interface DiffCardProps {
  filePath: string;
  additions: number;
  deletions: number;
  onAccept?: () => void;
  onReject?: () => void;
  onView?: () => void;
}

export function DiffCard({ filePath, additions, deletions, onAccept, onReject, onView }: DiffCardProps) {
  const fileName = filePath.split(/[/\\]/).pop() || filePath;

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl overflow-hidden"
      style={cardStyles}
    >
      <div
        className="flex items-center gap-3 px-4 py-2.5"
        style={{ backgroundColor: 'rgba(255, 255, 255, 0.02)' }}
      >
        <GitBranch size={14} style={{ color: 'var(--color-error)', flexShrink: 0 }} />
        <div className="flex-1 min-w-0">
          <span
            className="text-sm font-medium block truncate"
            style={{ color: textStyles.primary }}
          >
            {fileName}
          </span>
          <div className="flex items-center gap-2 mt-1">
            <span
              className="text-sm font-mono"
              style={{ color: actionColors.created }}
            >
              +{additions}
            </span>
            <span
              className="text-sm font-mono"
              style={{ color: actionColors.deleted }}
            >
              -{deletions}
            </span>
            <span
              className="text-xs"
              style={{ color: textStyles.dimmed }}
            >
              lignes
            </span>
          </div>
        </div>
      </div>

      {(onView || onAccept || onReject) && (
        <div
          className="flex items-center gap-1 px-3 py-2 border-t"
          style={{ borderColor: 'var(--border-base)', backgroundColor: 'rgba(0, 0, 0, 0.08)' }}
        >
          {onView && (
            <button
              onClick={onView}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                         hover:bg-white/8 transition-colors focus:outline-none focus:ring-1 focus:ring-white/20"
              style={{ color: textStyles.accent }}
            >
              <Eye size={12} />
              Voir
            </button>
          )}
          {onAccept && (
            <button
              onClick={onAccept}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                         hover:bg-green-500/10 transition-colors focus:outline-none focus:ring-1 focus:ring-green-500/30"
              style={{ color: actionColors.created }}
            >
              <Check size={12} />
              Accepter
            </button>
          )}
          {onReject && (
            <button
              onClick={onReject}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                         hover:bg-red-500/10 transition-colors focus:outline-none focus:ring-1 focus:ring-red-500/30"
              style={{ color: actionColors.deleted }}
            >
              <X size={12} />
              Annuler
            </button>
          )}
        </div>
      )}
    </motion.div>
  );
}

// ── Package Card ───────────────────────────────────────────────────────────
interface PackageCardProps {
  name: string;
  version?: string;
  action: 'install' | 'update' | 'remove';
}

export function PackageCard({ name, version, action }: PackageCardProps) {
  const labels = { install: 'Installé', update: 'Mis à jour', remove: 'Supprimé' };

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center gap-3 px-4 py-2.5 rounded-xl"
      style={cardStyles}
    >
      <Package
        size={14}
        style={{ color: actionColors[action], flexShrink: 0 }}
      />
      <span
        className="text-xs font-mono flex-1 truncate"
        style={{ color: textStyles.primary }}
      >
        {name}
        {version && (
          <span style={{ color: textStyles.dimmed }}>@{version}</span>
        )}
      </span>
      <span
        className="text-xs font-semibold uppercase px-2 py-0.5 rounded-full"
        style={badgeStyles(actionColors[action])}
      >
        {labels[action]}
      </span>
    </motion.div>
  );
}

// ── Changes Summary ─────────────────────────────────────────────────────────
interface ChangesSummaryProps {
  files: { path: string; additions: number; deletions: number }[];
  onAcceptAll?: () => void;
  onRejectAll?: () => void;
  onViewFile?: (path: string) => void;
}

export function ChangesSummary({ files, onAcceptAll, onRejectAll, onViewFile }: ChangesSummaryProps) {
  const [expanded, setExpanded] = useState(true);
  const totalAdd = files.reduce((s, f) => s + f.additions, 0);
  const totalDel = files.reduce((s, f) => s + f.deletions, 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl overflow-hidden"
      style={cardStyles}
    >
      <div
        className="flex items-center gap-3 px-4 py-2.5 cursor-pointer
                   hover:bg-white/5 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <GitBranch size={14} style={{ color: 'var(--color-error)', flexShrink: 0 }} />
        <span
          className="text-sm font-semibold flex-1 truncate"
          style={{ color: textStyles.primary }}
        >
          {files.length} fichier{files.length > 1 ? 's' : ''} modifié{files.length > 1 ? 's' : ''}
        </span>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span
            className="text-sm font-mono"
            style={{ color: actionColors.created }}
          >
            +{totalAdd}
          </span>
          <span
            className="text-sm font-mono"
            style={{ color: actionColors.deleted }}
          >
            -{totalDel}
          </span>
          {expanded ? (
            <ChevronDown size={12} style={{ color: textStyles.dimmed }} />
          ) : (
            <ChevronRight size={12} style={{ color: textStyles.dimmed }} />
          )}
        </div>
      </div>

      {expanded && files.length > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="border-t"
          style={{ borderColor: 'var(--border-base)' }}
        >
          {files.map((f) => {
            const name = f.path.split(/[/\\]/).pop() || f.path;
            return (
              <div
                key={f.path}
                className="flex items-center gap-3 px-4 py-2 hover:bg-white/5 transition-colors
                           cursor-pointer border-b last:border-0"
                style={{ borderColor: 'var(--border-base)' }}
                onClick={() => onViewFile?.(f.path)}
              >
                <FileText size={12} style={{ color: textStyles.muted, flexShrink: 0 }} />
                <span
                  className="text-sm flex-1 truncate"
                  style={{ color: textStyles.primary }}
                >
                  {name}
                </span>
                <span
                  className="text-xs font-mono"
                  style={{ color: actionColors.created }}
                >
                  +{f.additions}
                </span>
                <span
                  className="text-xs font-mono"
                  style={{ color: actionColors.deleted }}
                >
                  -{f.deletions}
                </span>
              </div>
            );
          })}
        </motion.div>
      )}

      {(onAcceptAll || onRejectAll) && (
        <div
          className="flex items-center gap-1 px-3 py-2 border-t"
          style={{ borderColor: 'var(--border-base)', backgroundColor: 'rgba(0, 0, 0, 0.08)' }}
        >
          {onAcceptAll && (
            <button
              onClick={onAcceptAll}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                         hover:bg-green-500/10 transition-colors focus:outline-none focus:ring-1 focus:ring-green-500/30"
              style={{ color: actionColors.created }}
            >
              <Check size={12} />
              Accepter tout
            </button>
          )}
          {onRejectAll && (
            <button
              onClick={onRejectAll}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                         hover:bg-red-500/10 transition-colors focus:outline-none focus:ring-1 focus:ring-red-500/30"
              style={{ color: actionColors.deleted }}
            >
              <X size={12} />
              Annuler tout
            </button>
          )}
        </div>
      )}
    </motion.div>
  );
}