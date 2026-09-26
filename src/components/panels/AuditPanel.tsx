import React from 'react';
import {
  ShieldCheck, Circle, CheckCircle2, AlertCircle, Loader2,
  Cpu, MemoryStick, Server, Puzzle, Activity, ExternalLink, RefreshCw,
} from 'lucide-react';
import { Panel } from '../ui/Panel.js';
import type { AuditStep, AuditReport } from '../../utils/audit.js';

interface AuditPanelProps {
  steps: AuditStep[];
  report?: AuditReport | null;
  onOpenRouter?: () => void;
  onRunAudit?: () => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function statusIcon(step: AuditStep) {
  switch (step.status) {
    case 'running':
      return <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: 'var(--accent-primary)' }} />;
    case 'done':
      return <CheckCircle2 className="w-3.5 h-3.5" style={{ color: 'var(--color-success)' }} />;
    case 'error':
      return <AlertCircle className="w-3.5 h-3.5" style={{ color: 'var(--color-error)' }} />;
    default:
      return <Circle className="w-3.5 h-3.5" style={{ color: 'var(--text-dimmed)' }} />;
  }
}

function stepIcon(id: string) {
  const cls = 'w-3 h-3';
  switch (id) {
    case 'os':        return <Server className={cls} />;
    case 'resources': return <Cpu className={cls} />;
    case 'services':  return <Activity className={cls} />;
    case 'skills':    return <Puzzle className={cls} />;
    default:          return <ShieldCheck className={cls} />;
  }
}

function HealthBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-xs font-semibold"
      style={{
        backgroundColor: ok ? 'color-mix(in srgb, var(--color-success) 12%, transparent)' : 'color-mix(in srgb, var(--color-error) 12%, transparent)',
        color: ok ? 'var(--color-success)' : 'var(--color-error)',
        border: `1px solid ${ok ? 'color-mix(in srgb, var(--color-success) 30%, transparent)' : 'color-mix(in srgb, var(--color-error) 30%, transparent)'}`,
      }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: ok ? 'var(--color-success)' : 'var(--color-error)' }} />
      {label}
    </span>
  );
}

function MemBar({ used, total }: { used: number; total: number }) {
  const pct = total > 0 ? Math.round((used / total) * 100) : 0;
  const color = pct > 85 ? 'var(--color-error)' : pct > 60 ? 'var(--color-warning)' : 'var(--color-success)';
  return (
    <div className="flex items-center gap-2 mt-1">
      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--border-base)' }}>
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-xs font-mono tabular-nums" style={{ color: 'var(--text-dimmed)' }}>
        {pct}%
      </span>
    </div>
  );
}

function scoreColor(score: number) {
  if (score >= 80) return 'var(--color-success)';
  if (score >= 50) return 'var(--color-warning)';
  return 'var(--color-error)';
}

// ── Main component ─────────────────────────────────────────────────────────

export const AuditPanel = React.memo(function AuditPanel({
  steps,
  report,
  onOpenRouter,
  onRunAudit,
}: AuditPanelProps) {
  const done     = steps.filter(s => s.status === 'done').length;
  const total    = steps.length;
  const progress = total > 0 ? Math.round((done / total) * 100) : 0;
  const allDone  = done === total;
  const isRunning = steps.some(s => s.status === 'running');

  // Simple health score: services + resource headroom
  const usedMemPct = report
    ? Math.round(((report.totalMemoryMB - report.freeMemoryMB) / report.totalMemoryMB) * 100)
    : 0;
  const serviceScore = report
    ? ([report.geminiOk, report.supabaseOk, report.openrouterOk].filter(Boolean).length / 3) * 50
    : 0;
  const resourceScore = report ? Math.max(0, 50 - usedMemPct * 0.3) : 0;
  const healthScore = report ? Math.round(serviceScore + resourceScore) : 0;

  return (
    <Panel
      title="Audit système"
      icon={<ShieldCheck className="w-4 h-4" />}
      actions={
        <div className="flex items-center gap-1.5">
          {onRunAudit && (
            <button
              onClick={onRunAudit}
              disabled={isRunning}
              className="flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-lg transition-all"
              style={{
                color: isRunning ? 'var(--text-dimmed)' : 'var(--bg-base)',
                backgroundColor: isRunning ? 'var(--border-base)' : 'var(--accent-primary)',
                cursor: isRunning ? 'not-allowed' : 'pointer',
                border: 'none',
              }}
              title="Lancer l'audit système"
            >
              <RefreshCw className={`w-3 h-3 ${isRunning ? 'animate-spin' : ''}`} />
              {isRunning ? 'En cours…' : 'Lancer'}
            </button>
          )}
          {onOpenRouter && (
            <button
              onClick={onOpenRouter}
              className="flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-lg transition-colors"
              style={{
                color: 'var(--accent-primary)',
                border: '1px solid var(--accent-primary)',
                backgroundColor: 'transparent',
              }}
              title="Ouvrir OpenRouter"
            >
              <ExternalLink className="w-3 h-3" />
              OpenRouter
            </button>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-3">

        {/* ── Progress bar ─────────────────────────────────── */}
        <div>
          <div className="flex justify-between items-center mb-1">
            <span className="text-xs" style={{ color: 'var(--text-dimmed)' }}>
              {allDone ? 'Audit terminé' : `Étape ${done} / ${total}`}
            </span>
            <span className="text-xs font-mono" style={{ color: 'var(--text-dimmed)' }}>
              {progress}%
            </span>
          </div>
          <div className="h-1 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--border-base)' }}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${progress}%`,
                backgroundColor: 'var(--accent-primary)',
              }}
            />
          </div>
        </div>

        {/* ── Steps ────────────────────────────────────────── */}
        {steps.map((step) => (
          <div
            key={step.id}
            className="rounded-xl border px-3 py-2 transition-colors"
            style={{
              borderColor: step.status === 'running'
                ? 'var(--accent-primary)'
                : step.status === 'error'
                  ? 'color-mix(in srgb, var(--color-error) 50%, transparent)'
                  : 'var(--border-base)',
              backgroundColor: 'var(--bg-secondary)',
            }}
          >
            <div className="flex items-start gap-2">
              <div className="mt-0.5 flex-shrink-0">{statusIcon(step)}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span style={{ color: 'var(--text-dimmed)' }}>{stepIcon(step.id)}</span>
                  <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {step.title}
                  </span>
                  {step.value && (
                    <span
                      className="ml-auto text-xs font-mono font-semibold px-1.5 py-0.5 rounded"
                      style={{
                        backgroundColor: 'var(--border-base)',
                        color: 'var(--accent-primary)',
                      }}
                    >
                      {step.value}
                    </span>
                  )}
                </div>
                <div className="text-xs mt-0.5" style={{ color: 'var(--text-dimmed)' }}>
                  {step.detail}
                </div>
              </div>
            </div>
          </div>
        ))}

        {/* ── Rich report ──────────────────────────────────── */}
        {report && allDone && (
          <>
            {/* Health score */}
            <div
              className="rounded-xl border px-3 py-2.5 flex items-center justify-between"
              style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-secondary)' }}
            >
              <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                Score de santé
              </span>
              <div className="flex items-center gap-2">
                <div className="w-20 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--border-base)' }}>
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${healthScore}%`, backgroundColor: scoreColor(healthScore) }}
                  />
                </div>
                <span
                  className="text-xs font-bold font-mono"
                  style={{ color: scoreColor(healthScore) }}
                >
                  {healthScore}/100
                </span>
              </div>
            </div>

            {/* OS + Node */}
            <div
              className="rounded-xl border px-3 py-2.5 grid grid-cols-2 gap-y-2 gap-x-3"
              style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-secondary)' }}
            >
              <Metric label="Plateforme" value={`${report.platform} ${report.arch}`} />
              <Metric label="Kernel"     value={report.release} />
              <Metric label="Node"       value={report.nodeVersion} />
              <Metric label="Uptime"     value={`${report.uptimeHours}h`} />
            </div>

            {/* CPU + RAM */}
            <div
              className="rounded-xl border px-3 py-2.5"
              style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-secondary)' }}
            >
              <div className="flex items-center gap-1.5 mb-2">
                <MemoryStick className="w-3 h-3" style={{ color: 'var(--text-dimmed)' }} />
                <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Ressources
                </span>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                <Metric label="CPU" value={`${report.cpus} cœurs`} />
                <Metric
                  label="RAM libre"
                  value={`${Math.round(report.freeMemoryMB / 1024 * 10) / 10} / ${Math.round(report.totalMemoryMB / 1024 * 10) / 10} Go`}
                />
              </div>
              <MemBar
                used={report.totalMemoryMB - report.freeMemoryMB}
                total={report.totalMemoryMB}
              />
            </div>

            {/* Services */}
            <div
              className="rounded-xl border px-3 py-2.5"
              style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-secondary)' }}
            >
              <span className="text-xs font-semibold block mb-2" style={{ color: 'var(--text-primary)' }}>
                Services
              </span>
              <div className="flex flex-wrap gap-1.5">
                <HealthBadge ok={report.geminiOk}      label="Gemini"      />
                <HealthBadge ok={report.supabaseOk}    label="Supabase"    />
                <HealthBadge ok={report.openrouterOk}  label="OpenRouter"  />
              </div>
            </div>

            {/* Skills */}
            {report.activeSkills.length > 0 && (
              <div
                className="rounded-xl border px-3 py-2.5"
                style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-secondary)' }}
              >
                <span className="text-xs font-semibold block mb-2" style={{ color: 'var(--text-primary)' }}>
                  Skills actifs ({report.activeSkills.length})
                </span>
                <div className="flex flex-wrap gap-1">
                  {report.activeSkills.map(s => (
                    <span
                      key={s}
                      className="px-1.5 py-0.5 rounded text-xs font-mono"
                      style={{
                        backgroundColor: 'var(--border-base)',
                        color: 'var(--accent-primary)',
                      }}
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Generated at */}
            <p className="text-xs text-center" style={{ color: 'var(--text-dimmed)' }}>
              Généré le {new Date(report.generatedAt).toLocaleString('fr-FR')}
            </p>
          </>
        )}
      </div>
    </Panel>
  );
});

// ── Sub-component ──────────────────────────────────────────────────────────

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs" style={{ color: 'var(--text-dimmed)' }}>{label}</p>
      <p className="text-sm font-semibold font-mono truncate" style={{ color: 'var(--text-primary)' }}>
        {value}
      </p>
    </div>
  );
}
