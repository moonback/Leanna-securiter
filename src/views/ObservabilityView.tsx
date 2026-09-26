/**
 * ObservabilityView — Cost & Token Dashboard
 *
 * Affiche :
 * - Vue d'ensemble (tokens totaux, coût total, appels LLM)
 * - Consommation par modèle (tableau + barres)
 * - Consommation par agent/rôle
 * - Top missions par coût
 * - Budget guardrails : configuration et statut
 * - Historique des 100 derniers appels modèle
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  BarChart2, RefreshCw, DollarSign, Cpu, Zap,
  AlertTriangle, CheckCircle2, Clock, TrendingUp,
  Shield, Trash2, Plus, Info,
} from 'lucide-react';
import { motion } from 'motion/react';
import { ViewHeader } from '../components/ui/ViewHeader.js';
import { useToast } from '../components/ui/Toast.js';

// ─── Types ──────────────────────────────────────────────────────────────────

interface DashboardOverview {
  totalTokens: number;
  totalCost: number;
  totalCalls: number;
}

interface ModelStat {
  model: string;
  tokens: number;
  cost: number;
  calls: number;
  avgTokensPerCall: number;
  avgCostPerCall: number;
}

interface AgentStat {
  role: string;
  tokens: number;
  cost: number;
  calls: number;
}

interface MissionStat {
  missionId: string;
  tokens: number;
  cost: number;
}

interface Dashboard {
  overview: DashboardOverview;
  byModel: ModelStat[];
  byAgent: AgentStat[];
  byMission: MissionStat[];
}

interface UsageRecord {
  id: string;
  missionId?: string;
  taskId?: string;
  agentRole?: string;
  provider: 'gemini' | 'openrouter';
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  timestamp: string;
}

interface BudgetConfig {
  maxTokens?: number;
  maxCostUsd?: number;
}

interface BudgetStatus {
  tokensUsed: number;
  costUsd: number;
  exceeded: boolean;
  reason?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmt(n: number, decimals = 0): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toFixed(decimals);
}

function fmtCost(usd: number): string {
  if (usd < 0.001) return `< $0.001`;
  if (usd < 1) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}j`;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  accent = false,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div
      className="flex flex-col gap-1 rounded-xl border p-4"
      style={{
        backgroundColor: 'var(--bg-panel)',
        borderColor: accent ? 'var(--accent-secondary)' : 'var(--border-base)',
      }}
    >
      <div className="flex items-center gap-2">
        <div
          className="flex h-7 w-7 items-center justify-center rounded-md"
          style={{ backgroundColor: 'var(--accent-subtle)' }}
        >
          <Icon className="h-3.5 w-3.5" style={{ color: 'var(--accent-secondary)' }} />
        </div>
        <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
          {label}
        </span>
      </div>
      <span className="text-2xl font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>
        {value}
      </span>
      {sub && (
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {sub}
        </span>
      )}
    </div>
  );
}

function BarRow({
  label,
  tokens,
  cost,
  calls,
  maxCost,
}: {
  label: string;
  tokens: number;
  cost: number;
  calls: number;
  maxCost: number;
}) {
  const pct = maxCost > 0 ? Math.round((cost / maxCost) * 100) : 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-xs">
        <span className="font-mono truncate max-w-[200px]" style={{ color: 'var(--text-primary)' }}>
          {label}
        </span>
        <div className="flex items-center gap-3 shrink-0 ml-2" style={{ color: 'var(--text-muted)' }}>
          <span>{fmt(tokens)} tokens</span>
          <span className="font-medium" style={{ color: 'var(--accent-secondary)' }}>
            {fmtCost(cost)}
          </span>
          <span>{calls} appels</span>
        </div>
      </div>
      <div
        className="h-1.5 w-full rounded-full overflow-hidden"
        style={{ backgroundColor: 'var(--bg-secondary)' }}
      >
        <motion.div
          className="h-full rounded-full"
          style={{ backgroundColor: 'var(--accent-secondary)' }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        />
      </div>
    </div>
  );
}

function BudgetPanel() {
  const { success: toastSuccess, error: toastError } = useToast();
  const [missionId, setMissionId] = useState('');
  const [maxTokens, setMaxTokens] = useState('');
  const [maxCostUsd, setMaxCostUsd] = useState('');
  const [checking, setChecking] = useState('');
  const [status, setStatus] = useState<{ missionId: string; budget: BudgetStatus } | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSetBudget = useCallback(async () => {
    if (!missionId.trim()) return;
    const body: BudgetConfig = {};
    if (maxTokens) body.maxTokens = parseInt(maxTokens, 10);
    if (maxCostUsd) body.maxCostUsd = parseFloat(maxCostUsd);
    if (!body.maxTokens && !body.maxCostUsd) {
      toastError('Fournissez au moins une limite (tokens ou coût).');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/observability/budget/${missionId.trim()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        toastSuccess('Budget configuré avec succès.');
        setMissionId('');
        setMaxTokens('');
        setMaxCostUsd('');
      } else {
        toastError(data.error || 'Erreur lors de la configuration du budget.');
      }
    } catch {
      toastError('Erreur réseau.');
    } finally {
      setSaving(false);
    }
  }, [missionId, maxTokens, maxCostUsd, toastSuccess, toastError]);

  const handleCheck = useCallback(async () => {
    if (!checking.trim()) return;
    try {
      const res = await fetch(`/api/observability/budget/${checking.trim()}`);
      const data = await res.json();
      if (data.success) setStatus(data);
      else toastError(data.error || 'Mission introuvable.');
    } catch {
      toastError('Erreur réseau.');
    }
  }, [checking, toastError]);

  const handleClear = useCallback(async (mid: string) => {
    try {
      await fetch(`/api/observability/budget/${mid}`, { method: 'DELETE' });
      setStatus(null);
      toastSuccess('Budget supprimé.');
    } catch {
      toastError('Erreur réseau.');
    }
  }, [toastSuccess, toastError]);

  return (
    <div className="rounded-xl border p-4 flex flex-col gap-4" style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-base)' }}>
      <div className="flex items-center gap-2">
        <Shield className="h-4 w-4" style={{ color: 'var(--accent-secondary)' }} />
        <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Budget Guardrails</span>
        <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--accent-subtle)', color: 'var(--accent-secondary)' }}>
          Arrêt automatique au dépassement
        </span>
      </div>

      {/* Configurer un budget */}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Configurer un plafond de mission</span>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <input
            value={missionId}
            onChange={e => setMissionId(e.target.value)}
            placeholder="ID de mission"
            className="rounded-lg border px-3 py-1.5 text-xs"
            style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border-base)', color: 'var(--text-primary)' }}
          />
          <input
            value={maxTokens}
            onChange={e => setMaxTokens(e.target.value)}
            placeholder="Max tokens (ex: 100000)"
            type="number"
            className="rounded-lg border px-3 py-1.5 text-xs"
            style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border-base)', color: 'var(--text-primary)' }}
          />
          <input
            value={maxCostUsd}
            onChange={e => setMaxCostUsd(e.target.value)}
            placeholder="Max coût USD (ex: 1.50)"
            type="number"
            step="0.01"
            className="rounded-lg border px-3 py-1.5 text-xs"
            style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border-base)', color: 'var(--text-primary)' }}
          />
        </div>
        <button
          onClick={handleSetBudget}
          disabled={saving || !missionId.trim()}
          className="self-start flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-opacity disabled:opacity-50"
          style={{ backgroundColor: 'var(--accent-secondary)', color: 'var(--bg-base)' }}
        >
          <Plus className="h-3.5 w-3.5" />
          {saving ? 'Enregistrement…' : 'Appliquer le budget'}
        </button>
      </div>

      {/* Vérifier un budget */}
      <div className="flex flex-col gap-2 border-t pt-3" style={{ borderColor: 'var(--border-base)' }}>
        <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Vérifier le statut d'un budget</span>
        <div className="flex gap-2">
          <input
            value={checking}
            onChange={e => setChecking(e.target.value)}
            placeholder="ID de mission"
            className="flex-1 rounded-lg border px-3 py-1.5 text-xs"
            style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border-base)', color: 'var(--text-primary)' }}
          />
          <button
            onClick={handleCheck}
            disabled={!checking.trim()}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-opacity disabled:opacity-50"
            style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-base)' }}
          >
            Vérifier
          </button>
        </div>

        {status && (
          <div
            className="rounded-lg border p-3 flex flex-col gap-1.5"
            style={{
              borderColor: status.budget.exceeded ? 'var(--color-red-500, #ef4444)' : 'var(--border-base)',
              backgroundColor: status.budget.exceeded ? 'rgba(239,68,68,0.07)' : 'var(--bg-secondary)',
            }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                {status.budget.exceeded
                  ? <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
                  : <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />}
                <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                  Mission: {status.missionId.slice(0, 12)}…
                </span>
              </div>
              <button onClick={() => handleClear(status.missionId)} title="Supprimer le budget">
                <Trash2 className="h-3.5 w-3.5" style={{ color: 'var(--text-muted)' }} />
              </button>
            </div>
            <div className="text-xs grid grid-cols-2 gap-1" style={{ color: 'var(--text-muted)' }}>
              <span>Tokens consommés : <strong style={{ color: 'var(--text-primary)' }}>{fmt(status.budget.tokensUsed)}</strong></span>
              <span>Coût : <strong style={{ color: 'var(--accent-secondary)' }}>{fmtCost(status.budget.costUsd)}</strong></span>
            </div>
            {status.budget.exceeded && status.budget.reason && (
              <span className="text-xs text-red-400">{status.budget.reason}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main View ───────────────────────────────────────────────────────────────

export default function ObservabilityView() {
  const { error: toastError } = useToast();
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [records, setRecords] = useState<UsageRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'overview' | 'usage' | 'budget'>('overview');
  const [period, setPeriod] = useState<'day' | 'hour'>('day');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchDashboard = useCallback(async () => {
    try {
      const [dashRes, usageRes] = await Promise.all([
        fetch('/api/observability/dashboard'),
        fetch('/api/observability/usage?limit=100'),
      ]);
      if (dashRes.ok) {
        const data = await dashRes.json();
        if (data.success) setDashboard(data.dashboard);
      }
      if (usageRes.ok) {
        const data = await usageRes.json();
        if (data.success) setRecords(data.records.reverse());
      }
    } catch {
      toastError('Impossible de charger les données d\'observabilité.');
    } finally {
      setLoading(false);
    }
  }, [toastError]);

  useEffect(() => {
    fetchDashboard();
    intervalRef.current = setInterval(fetchDashboard, 15_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchDashboard]);

  const maxModelCost = dashboard?.byModel[0]?.cost ?? 1;
  const maxAgentCost = dashboard?.byAgent[0]?.cost ?? 1;

  return (
    <div className="flex h-full flex-col overflow-hidden" style={{ backgroundColor: 'var(--bg-base)' }}>
      <ViewHeader
        title="Observabilité"
        icon={BarChart2}
        description="Coûts, tokens et traces OpenTelemetry en temps réel"
        badge="V1.1"
        actions={
          <div className="flex items-center gap-2">
            {/* Period toggle */}
            <div className="flex rounded-lg overflow-hidden border text-xs" style={{ borderColor: 'var(--border-base)' }}>
              {(['day', 'hour'] as const).map(p => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className="px-3 py-1.5 font-medium transition-colors"
                  style={{
                    backgroundColor: period === p ? 'var(--accent-subtle)' : 'var(--bg-panel)',
                    color: period === p ? 'var(--accent-secondary)' : 'var(--text-muted)',
                  }}
                >
                  {p === 'day' ? '24h' : '1h'}
                </button>
              ))}
            </div>
            <button
              onClick={fetchDashboard}
              className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-[var(--bg-secondary)]"
              style={{ borderColor: 'var(--border-base)', color: 'var(--text-primary)' }}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              Actualiser
            </button>
          </div>
        }
      />

      {/* Tabs */}
      <div
        className="flex border-b"
        style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-base)' }}
      >
        {([
          { key: 'overview', label: 'Vue d\'ensemble', icon: TrendingUp },
          { key: 'usage', label: 'Historique', icon: Clock },
          { key: 'budget', label: 'Budget Guardrails', icon: Shield },
        ] as const).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className="flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors"
            style={{
              borderBottomColor: tab === key ? 'var(--accent-secondary)' : 'transparent',
              color: tab === key ? 'var(--accent-secondary)' : 'var(--text-muted)',
            }}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5">

        {loading && (
          <div className="flex items-center justify-center h-40">
            <RefreshCw className="h-6 w-6 animate-spin" style={{ color: 'var(--text-muted)' }} />
          </div>
        )}

        {!loading && tab === 'overview' && (
          <>
            {/* Overview cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <StatCard
                icon={Zap}
                label="Tokens totaux"
                value={fmt(dashboard?.overview.totalTokens ?? 0)}
                sub={`${period === 'day' ? 'dernières 24h' : 'dernière heure'}`}
              />
              <StatCard
                icon={DollarSign}
                label="Coût total"
                value={fmtCost(dashboard?.overview.totalCost ?? 0)}
                accent
                sub="USD"
              />
              <StatCard
                icon={Cpu}
                label="Appels LLM"
                value={fmt(dashboard?.overview.totalCalls ?? 0)}
                sub="model calls"
              />
            </div>

            {/* By model */}
            {(dashboard?.byModel.length ?? 0) > 0 && (
              <div
                className="rounded-xl border p-4 flex flex-col gap-3"
                style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-base)' }}
              >
                <div className="flex items-center gap-2">
                  <Cpu className="h-4 w-4" style={{ color: 'var(--accent-secondary)' }} />
                  <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                    Par modèle
                  </span>
                </div>
                <div className="flex flex-col gap-3">
                  {dashboard!.byModel.map(m => (
                    <BarRow
                      key={m.model}
                      label={m.model}
                      tokens={m.tokens}
                      cost={m.cost}
                      calls={m.calls}
                      maxCost={maxModelCost}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* By agent */}
            {(dashboard?.byAgent.length ?? 0) > 0 && (
              <div
                className="rounded-xl border p-4 flex flex-col gap-3"
                style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-base)' }}
              >
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4" style={{ color: 'var(--accent-secondary)' }} />
                  <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                    Par agent
                  </span>
                </div>
                <div className="flex flex-col gap-3">
                  {dashboard!.byAgent.map(a => (
                    <BarRow
                      key={a.role}
                      label={a.role}
                      tokens={a.tokens}
                      cost={a.cost}
                      calls={a.calls}
                      maxCost={maxAgentCost}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Top missions */}
            {(dashboard?.byMission.length ?? 0) > 0 && (
              <div
                className="rounded-xl border p-4 flex flex-col gap-3"
                style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-base)' }}
              >
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4" style={{ color: 'var(--accent-secondary)' }} />
                  <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                    Top missions par coût
                  </span>
                </div>
                <div className="flex flex-col gap-1.5">
                  {dashboard!.byMission.slice(0, 10).map(m => (
                    <div key={m.missionId} className="flex items-center justify-between text-xs">
                      <span className="font-mono truncate max-w-[200px]" style={{ color: 'var(--text-muted)' }}>
                        {m.missionId.slice(0, 18)}…
                      </span>
                      <div className="flex gap-3 shrink-0">
                        <span style={{ color: 'var(--text-primary)' }}>{fmt(m.tokens)} tok</span>
                        <span className="font-medium" style={{ color: 'var(--accent-secondary)' }}>
                          {fmtCost(m.cost)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Empty state */}
            {!dashboard || (dashboard.overview.totalCalls === 0) ? (
              <div className="flex flex-col items-center gap-3 py-16 text-center">
                <div
                  className="flex h-12 w-12 items-center justify-center rounded-full"
                  style={{ backgroundColor: 'var(--accent-subtle)' }}
                >
                  <Info className="h-6 w-6" style={{ color: 'var(--accent-secondary)' }} />
                </div>
                <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                  Aucune donnée pour le moment
                </p>
                <p className="text-xs max-w-xs" style={{ color: 'var(--text-muted)' }}>
                  Les coûts et tokens apparaîtront ici dès qu'un appel LLM sera effectué via le système d'agents ou les missions.
                </p>
              </div>
            ) : null}
          </>
        )}

        {/* Usage history tab */}
        {!loading && tab === 'usage' && (
          <div
            className="rounded-xl border overflow-hidden"
            style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-base)' }}
          >
            <table className="w-full text-xs">
              <thead>
                <tr style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-muted)' }}>
                  <th className="px-3 py-2 text-left font-medium">Heure</th>
                  <th className="px-3 py-2 text-left font-medium">Modèle</th>
                  <th className="px-3 py-2 text-left font-medium">Agent</th>
                  <th className="px-3 py-2 text-right font-medium">Tokens in</th>
                  <th className="px-3 py-2 text-right font-medium">Tokens out</th>
                  <th className="px-3 py-2 text-right font-medium">Coût</th>
                </tr>
              </thead>
              <tbody>
                {records.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center" style={{ color: 'var(--text-muted)' }}>
                      Aucun enregistrement
                    </td>
                  </tr>
                )}
                {records.map(r => (
                  <tr
                    key={r.id}
                    className="border-t transition-colors hover:bg-[var(--bg-secondary)]"
                    style={{ borderColor: 'var(--border-base)' }}
                  >
                    <td className="px-3 py-1.5 tabular-nums" style={{ color: 'var(--text-muted)' }}>
                      {timeAgo(r.timestamp)}
                    </td>
                    <td className="px-3 py-1.5 font-mono max-w-[180px] truncate" style={{ color: 'var(--text-primary)' }}>
                      {r.model}
                    </td>
                    <td className="px-3 py-1.5" style={{ color: 'var(--text-muted)' }}>
                      {r.agentRole ?? '—'}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums" style={{ color: 'var(--text-primary)' }}>
                      {fmt(r.inputTokens)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums" style={{ color: 'var(--text-primary)' }}>
                      {fmt(r.outputTokens)}
                    </td>
                    <td
                      className="px-3 py-1.5 text-right font-medium tabular-nums"
                      style={{ color: 'var(--accent-secondary)' }}
                    >
                      {fmtCost(r.costUsd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Budget tab */}
        {!loading && tab === 'budget' && <BudgetPanel />}
      </div>
    </div>
  );
}
