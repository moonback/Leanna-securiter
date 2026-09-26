/**
 * CodeSnippet.tsx
 * Monaco-backed read-only code viewer with vulnerable line highlighting.
 * Falls back to a styled <pre> when Monaco is not ready.
 */
import { useRef, useEffect, useState } from 'react';
import { Copy, CheckCheck } from 'lucide-react';

interface CodeSnippetProps {
  code: string;
  language?: string;
  /** 1-indexed line to highlight as vulnerable */
  vulnerableLine?: number;
  /** 1-indexed first line of the snippet in the real file (for display) */
  startLine?: number;
  filename?: string;
  maxHeight?: number;
}

export function CodeSnippet({
  code,
  language = 'typescript',
  vulnerableLine,
  startLine = 1,
  filename,
  maxHeight = 260,
}: CodeSnippetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<unknown>(null);
  const [monacoReady, setMonacoReady] = useState(false);
  const [copied, setCopied] = useState(false);

  // Lazy-load Monaco to avoid blocking paint
  useEffect(() => {
    let cancelled = false;

    import('@monaco-editor/react').then(({ loader }) => {
      if (cancelled) return;
      loader.init().then(() => {
        if (!cancelled) setMonacoReady(true);
      });
    }).catch(() => { /* fallback to <pre> */ });

    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!monacoReady || !containerRef.current) return;

    let editor: any;
    let disposable: any;

    import('@monaco-editor/react').then(({ loader }) => {
      loader.init().then((monaco: any) => {
        if (!containerRef.current) return;

        // Dark security theme
        monaco.editor.defineTheme('sec-dark', {
          base: 'vs-dark',
          inherit: true,
          rules: [{ token: '', background: '0d1117' }],
          colors: {
            'editor.background': '#0d1117',
            'editor.lineHighlightBackground': '#1c2128',
            'editorGutter.background': '#0d1117',
          },
        });

        editor = monaco.editor.create(containerRef.current!, {
          value: code,
          language,
          readOnly: true,
          theme: 'sec-dark',
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          lineNumbers: (lineNumber: number) => String(startLine + lineNumber - 1),
          folding: false,
          glyphMargin: false,
          lineDecorationsWidth: 0,
          overviewRulerLanes: 0,
          renderLineHighlight: 'none',
          scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6 },
          fontSize: 12.5,
          fontFamily: '"JetBrains Mono", "Fira Code", monospace',
          contextmenu: false,
          automaticLayout: true,
        });

        editorRef.current = editor;

        // Highlight the vulnerable line
        if (vulnerableLine !== undefined) {
          const vuln = vulnerableLine - startLine + 1;
          const decorations = editor.createDecorationsCollection([
            {
              range: new monaco.Range(vuln, 1, vuln, 1),
              options: {
                isWholeLine: true,
                className: 'sec-vuln-line',
                glyphMarginClassName: 'sec-vuln-glyph',
                overviewRuler: { color: '#dc2626', position: 1 },
              },
            },
          ]);

          // Inject CSS once
          if (!document.getElementById('sec-monaco-css')) {
            const style = document.createElement('style');
            style.id = 'sec-monaco-css';
            style.textContent = `
              .sec-vuln-line { background: rgba(220,38,38,0.14) !important; border-left: 3px solid #dc2626; }
            `;
            document.head.appendChild(style);
          }
        }
      });
    });

    return () => {
      disposable?.dispose();
      editor?.dispose();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monacoReady, code, language, vulnerableLine, startLine]);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const lineCount = code.split('\n').length;
  const height = Math.min(maxHeight, Math.max(72, lineCount * 19 + 16));

  return (
    <div style={{
      position: 'relative',
      borderRadius: 'var(--radius-md, 8px)',
      overflow: 'hidden',
      border: '1px solid rgba(255,255,255,0.08)',
      background: '#0d1117',
    }}>
      {/* ── Toolbar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '6px 12px',
        background: 'rgba(255,255,255,0.03)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}>
        <span style={{ fontSize: 11, color: '#6b7280', fontFamily: 'var(--font-mono)' }}>
          {filename ?? language}
        </span>
        <button
          onClick={handleCopy}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px',
            display: 'flex', alignItems: 'center', gap: 4, color: '#6b7280', fontSize: 11 }}
        >
          {copied ? <CheckCheck size={12} color="#22c55e" /> : <Copy size={12} />}
          {copied ? 'Copié' : 'Copier'}
        </button>
      </div>

      {/* ── Code body ── */}
      {monacoReady ? (
        <div ref={containerRef} style={{ height, width: '100%' }} />
      ) : (
        <pre style={{
          margin: 0, padding: '12px 16px', height,
          overflowY: 'auto', overflowX: 'auto',
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: 12.5, lineHeight: 1.65,
          color: '#e2e8f0', whiteSpace: 'pre',
        }}>
          {code.split('\n').map((line, i) => {
            const lineNo = startLine + i;
            const isVuln = vulnerableLine !== undefined && lineNo === vulnerableLine;
            return (
              <div
                key={i}
                style={{
                  background: isVuln ? 'rgba(220,38,38,0.14)' : undefined,
                  borderLeft: isVuln ? '3px solid #dc2626' : '3px solid transparent',
                  paddingLeft: 12,
                }}
              >
                <span style={{ marginRight: 16, color: '#4b5563', userSelect: 'none', minWidth: 32, display: 'inline-block' }}>
                  {lineNo}
                </span>
                {line}
              </div>
            );
          })}
        </pre>
      )}
    </div>
  );
}
