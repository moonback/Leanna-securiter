/**
 * SarifExportDialog.tsx
 * Modal for triggering SARIF 2.1.0 / CycloneDX SBOM / HTML report exports.
 */
import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Download, X, FileCode2, Package, FileText, CheckCircle2, Loader2, Copy, CheckCheck } from 'lucide-react';

type ExportFormat = 'sarif' | 'cyclonedx' | 'spdx' | 'html' | 'pdf';

interface ExportOption {
  id: ExportFormat;
  label: string;
  description: string;
  icon: React.ComponentType<{ size?: number; color?: string }>;
  color: string;
  extension: string;
}

const EXPORT_OPTIONS: ExportOption[] = [
  {
    id: 'sarif',
    label: 'SARIF 2.1.0',
    description: 'Compatible GitHub Code Scanning, VS Code, DefectDojo',
    icon: FileCode2,
    color: '#3b82f6',
    extension: '.sarif.json',
  },
  {
    id: 'cyclonedx',
    label: 'CycloneDX 1.5',
    description: 'SBOM avec CVE, EPSS et données de licence',
    icon: Package,
    color: '#f59e0b',
    extension: '.cdx.json',
  },
  {
    id: 'spdx',
    label: 'SPDX 2.3',
    description: 'SBOM format OpenChain / Linux Foundation',
    icon: Package,
    color: '#22c55e',
    extension: '.spdx.json',
  },
  {
    id: 'html',
    label: 'Rapport HTML',
    description: 'Rapport complet auto-contenu avec charts',
    icon: FileText,
    color: '#6366f1',
    extension: '.html',
  },
  {
    id: 'pdf',
    label: 'Rapport PDF',
    description: 'Version imprimable pour audit client',
    icon: FileText,
    color: '#a855f7',
    extension: '.pdf',
  },
];

interface SarifExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called when user confirms. Return a download URL or blob URL. */
  onExport?: (format: ExportFormat, options: ExportOptions) => Promise<string>;
  scanId?: string;
  findingsCount?: number;
}

interface ExportOptions {
  includeSnippets: boolean;
  includeRemediation: boolean;
  includeSbom: boolean;
  minSeverity: 'critical' | 'high' | 'medium' | 'low' | 'info';
}

export function SarifExportDialog({
  isOpen,
  onClose,
  onExport,
  scanId,
  findingsCount,
}: SarifExportDialogProps) {
  const [selected, setSelected] = useState<ExportFormat>('sarif');
  const [options, setOptions] = useState<ExportOptions>({
    includeSnippets:    true,
    includeRemediation: true,
    includeSbom:        true,
    minSeverity:        'low',
  });
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [downloadUrl, setDownloadUrl] = useState('');
  const [copied, setCopied] = useState(false);

  const current = EXPORT_OPTIONS.find((o) => o.id === selected)!;

  const handleExport = async () => {
    if (!onExport) {
      // Demo mode: simulate download
      setStatus('loading');
      await new Promise((r) => setTimeout(r, 1200));
      setDownloadUrl('#demo');
      setStatus('done');
      return;
    }
    setStatus('loading');
    try {
      const url = await onExport(selected, options);
      setDownloadUrl(url);
      setStatus('done');
    } catch {
      setStatus('error');
    }
  };

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(downloadUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleClose = () => {
    setStatus('idle');
    setDownloadUrl('');
    onClose();
  };

  const toggle = (key: keyof ExportOptions) =>
    setOptions((prev) => ({ ...prev, [key]: !prev[key as keyof typeof prev] }));

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
            style={{
              position: 'fixed', inset: 0,
              background: 'rgba(0,0,0,0.6)',
              backdropFilter: 'blur(6px)',
              zIndex: 1000,
            }}
          />

          {/* Dialog */}
          <motion.div
            key="dialog"
            initial={{ opacity: 0, scale: 0.94, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 24 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            style={{
              position: 'fixed',
              top: '50%', left: '50%',
              transform: 'translate(-50%, -50%)',
              width: 560, maxWidth: 'calc(100vw - 32px)',
              background: '#0f1117',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 'var(--radius-2xl, 16px)',
              boxShadow: '0 32px 80px rgba(0,0,0,0.6)',
              zIndex: 1001,
              overflow: 'hidden',
            }}
          >
            {/* Header */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '16px 20px',
              borderBottom: '1px solid rgba(255,255,255,0.08)',
              background: 'rgba(255,255,255,0.02)',
            }}>
              <Download size={18} color="#6366f1" />
              <span style={{ fontSize: 15, fontWeight: 700, color: '#e2e8f0', flex: 1 }}>
                Exporter le rapport
              </span>
              {scanId && (
                <span style={{ fontSize: 11, color: '#4b5563', fontFamily: 'var(--font-mono)' }}>
                  {scanId}
                </span>
              )}
              {findingsCount !== undefined && (
                <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 'var(--radius-full)',
                  background: 'rgba(239,68,68,0.12)', color: '#f87171', fontWeight: 600 }}>
                  {findingsCount} finding{findingsCount !== 1 ? 's' : ''}
                </span>
              )}
              <button
                onClick={handleClose}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: '#4b5563' }}>
                <X size={16} />
              </button>
            </div>

            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Format selector */}
              <div>
                <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, letterSpacing: '0.06em', marginBottom: 8 }}>
                  FORMAT
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                  {EXPORT_OPTIONS.map((opt) => {
                    const Icon = opt.icon;
                    const active = selected === opt.id;
                    return (
                      <button
                        key={opt.id}
                        onClick={() => setSelected(opt.id)}
                        style={{
                          padding: '10px 12px',
                          borderRadius: 'var(--radius-md)',
                          border: active ? `1.5px solid ${opt.color}` : '1px solid rgba(255,255,255,0.08)',
                          background: active ? opt.color + '15' : 'rgba(255,255,255,0.03)',
                          cursor: 'pointer', textAlign: 'left',
                          transition: 'all 0.15s',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
                          <Icon size={13} color={active ? opt.color : '#6b7280'} />
                          <span style={{ fontSize: 12, fontWeight: 700, color: active ? opt.color : '#94a3b8' }}>
                            {opt.label}
                          </span>
                        </div>
                        <div style={{ fontSize: 10.5, color: '#4b5563', lineHeight: 1.4 }}>
                          {opt.description}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Options */}
              <div>
                <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, letterSpacing: '0.06em', marginBottom: 8 }}>
                  OPTIONS
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {(
                    [
                      { key: 'includeSnippets',    label: 'Inclure les extraits de code' },
                      { key: 'includeRemediation', label: 'Inclure les recommendations' },
                      { key: 'includeSbom',        label: 'Inclure le SBOM' },
                    ] as const
                  ).map(({ key, label }) => (
                    <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                      <div
                        onClick={() => toggle(key)}
                        style={{
                          width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                          border: options[key] ? '1.5px solid #6366f1' : '1.5px solid rgba(255,255,255,0.15)',
                          background: options[key] ? '#6366f1' : 'transparent',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          transition: 'all 0.15s',
                        }}
                      >
                        {options[key] && <CheckCircle2 size={11} color="#fff" />}
                      </div>
                      <span style={{ fontSize: 12.5, color: '#94a3b8' }}>{label}</span>
                    </label>
                  ))}

                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
                    <span style={{ fontSize: 12, color: '#6b7280' }}>Sévérité minimum :</span>
                    <select
                      value={options.minSeverity}
                      onChange={(e) => setOptions((p) => ({ ...p, minSeverity: e.target.value as any }))}
                      style={{
                        fontSize: 12, padding: '3px 8px', borderRadius: 'var(--radius-sm)',
                        background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                        color: '#e2e8f0', cursor: 'pointer', outline: 'none',
                      }}
                    >
                      {['critical', 'high', 'medium', 'low', 'info'].map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>

              {/* Action / result */}
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                {status === 'done' ? (
                  <>
                    <a
                      href={downloadUrl}
                      download={`leanna-scan${current.extension}`}
                      style={{
                        flex: 1, padding: '10px 0', textAlign: 'center',
                        background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.3)',
                        borderRadius: 'var(--radius-md)',
                        color: '#4ade80', fontSize: 13, fontWeight: 600,
                        textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                      }}
                    >
                      <Download size={14} />
                      Télécharger {current.label}{current.extension}
                    </a>
                    <button
                      onClick={handleCopyUrl}
                      style={{
                        padding: '10px 14px', background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: 'var(--radius-md)', cursor: 'pointer',
                        color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 5, fontSize: 12,
                      }}>
                      {copied ? <CheckCheck size={13} color="#22c55e" /> : <Copy size={13} />}
                    </button>
                  </>
                ) : (
                  <button
                    onClick={handleExport}
                    disabled={status === 'loading'}
                    style={{
                      flex: 1, padding: '11px 0',
                      background: status === 'loading' ? 'rgba(99,102,241,0.2)' : 'rgba(99,102,241,0.85)',
                      border: '1px solid rgba(99,102,241,0.5)',
                      borderRadius: 'var(--radius-md)',
                      color: '#e0e7ff', fontSize: 13, fontWeight: 600,
                      cursor: status === 'loading' ? 'wait' : 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                      transition: 'all 0.15s',
                    }}
                  >
                    {status === 'loading'
                      ? <><Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> Génération…</>
                      : <><Download size={15} /> Générer {current.label}</>}
                  </button>
                )}
              </div>

              {status === 'error' && (
                <div style={{ fontSize: 12, color: '#f87171', textAlign: 'center' }}>
                  Erreur lors de la génération. Réessayez.
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
