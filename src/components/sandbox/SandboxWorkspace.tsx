import { Suspense, lazy } from 'react';
import { Box, CheckCircle2, Eye, X } from 'lucide-react';

const SandboxPanel = lazy(() =>
  import('../panels/SandboxPanel.js').then((module) => ({ default: module.SandboxPanel })),
);
const SandboxDiffViewer = lazy(() =>
  import('./SandboxDiffViewer.js').then((module) => ({ default: module.SandboxDiffViewer })),
);

type SandboxWorkspaceView = 'controls' | 'diff';

interface SandboxWorkspaceProps {
  view: SandboxWorkspaceView;
  selectedFile: string | null;
  onClose: () => void;
  onOpenDiff: (initialFile?: string | null) => void;
  onCloseDiff: () => void;
}

function SandboxLoading() {
  return (
    <div className="flex flex-1 items-center justify-center" style={{ color: 'var(--text-muted)' }}>
      <div className="flex items-center gap-2 text-xs">
        <Box size={14} className="animate-pulse" />
        Chargement du sandbox...
      </div>
    </div>
  );
}

export function SandboxWorkspace({
  view,
  selectedFile,
  onClose,
  onOpenDiff,
  onCloseDiff,
}: SandboxWorkspaceProps) {
  return (
    <section
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
      aria-label="Espace sandbox"
      style={{ backgroundColor: 'var(--bg-panel)' }}
    >
      <header
        className="relative flex shrink-0 items-center justify-between border-b px-5 py-3.5"
        style={{
          borderColor: 'var(--border-base)',
          background: 'linear-gradient(105deg, color-mix(in srgb, var(--bg-panel) 92%, var(--accent-primary)), var(--bg-panel))',
        }}
      >
        <div className="flex min-w-0 items-center gap-3">
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border"
            style={{
              color: 'var(--accent-primary)',
              borderColor: 'color-mix(in srgb, var(--accent-primary) 30%, var(--border-base))',
              backgroundColor: 'color-mix(in srgb, var(--accent-primary) 12%, transparent)',
            }}
          >
            {view === 'diff' ? <Eye size={17} /> : <Box size={17} />}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                Sandbox
              </h2>
              <span
                className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium"
                style={{
                  color: 'var(--color-success)',
                  borderColor: 'color-mix(in srgb, var(--color-success) 28%, transparent)',
                  backgroundColor: 'color-mix(in srgb, var(--color-success) 10%, transparent)',
                }}
              >
                <CheckCircle2 size={10} />
                Isolé
              </span>
            </div>
            <p className="mt-0.5 truncate text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {view === 'diff' ? 'Comparer et valider les changements' : 'Examiner les changements avant synchronisation'}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-2 transition hover:bg-white/10"
          title="Fermer le sandbox"
          aria-label="Fermer le sandbox"
        >
          <X size={16} style={{ color: 'var(--text-muted)' }} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
        <Suspense fallback={<SandboxLoading />}>
          {view === 'diff' ? (
            <SandboxDiffViewer
              embedded
              initialSelectedFile={selectedFile}
              onClose={onCloseDiff}
            />
          ) : (
            <SandboxPanel onOpenDiff={onOpenDiff} />
          )}
        </Suspense>
      </div>
    </section>
  );
}
