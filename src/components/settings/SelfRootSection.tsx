import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Shield, GitBranch, CheckCircle2, AlertTriangle, RefreshCw,
  FolderOpen, Save, Loader2, Upload, ShieldAlert,
  Trash2, ArrowRight, ShieldCheck, Lock,
} from 'lucide-react';
import { Section, Field, InfoRow } from './SettingsPrimitives.js';
import { ideApi } from '../../services/ideApi.js';

interface SelfRootStatus {
  rootPath: string | null;
  locked: boolean;
  gitBranch: string;
  gitStatus: 'clean' | 'dirty' | 'unknown';
  lastCommit: string;
  lastCommitDate: string;
  aheadBehind: { ahead: number; behind: number };
}

interface WorkspaceItem {
  id: string;
  name: string;
  path: string;
  siteUrl?: string;
  lastOpened: string;
  createdAt: string;
  isGit: boolean;
  gitBranch?: string;
}

const FALLBACK_STATUS: SelfRootStatus = {
  rootPath: '(en attente du serveur)',
  locked: true,
  gitBranch: '—',
  gitStatus: 'unknown',
  lastCommit: '—',
  lastCommitDate: '—',
  aheadBehind: { ahead: 0, behind: 0 },
};

function getElectronAPI(): { selectFolder: () => Promise<string | null> } | null {
  const w = window as any;
  return w.electronAPI?.selectFolder ? w.electronAPI : null;
}

export function SelfRootSection() {
  const [status, setStatus] = useState<SelfRootStatus | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pathInput, setPathInput] = useState('');
  const [siteUrlInput, setSiteUrlInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const hasFetched = useRef(false);

  // Local confirmation modal
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const [pendingSiteUrl, setPendingSiteUrl] = useState<string | undefined>(undefined);
  const [pendingName, setPendingName] = useState<string | undefined>(undefined);

  const fetchWorkspaces = useCallback(async () => {
    try {
      const res = await fetch('/api/self-root/workspaces');
      if (res.ok) {
        const data = await res.json();
        setWorkspaces(data.workspaces || []);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/self-root/status');
      if (res.status === 429) {
        setError('Rate limit — réessayez dans quelques secondes.');
        if (!status) setStatus(FALLBACK_STATUS);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setStatus(data);
      if (data.rootPath) {
        setPathInput(data.rootPath);
      }
      if (data.siteUrl) {
        setSiteUrlInput(data.siteUrl);
      }
      await fetchWorkspaces();
    } catch (e: any) {
      setError(e.message || 'Impossible de récupérer le statut');
      if (!status) setStatus(FALLBACK_STATUS);
    } finally {
      setLoading(false);
    }
  }, [fetchWorkspaces]);

  useEffect(() => {
    if (hasFetched.current) return;
    hasFetched.current = true;
    fetchStatus();
  }, [fetchStatus]);

  const handleSave = useCallback(() => {
    const trimmed = pathInput.trim();
    if (!trimmed || trimmed === status?.rootPath) return;
    setPendingPath(trimmed);
    setPendingSiteUrl(siteUrlInput.trim() || undefined);
    setPendingName(undefined);
  }, [pathInput, siteUrlInput, status]);

  const handleSwitchWorkspace = (ws: WorkspaceItem) => {
    if (ws.path === status?.rootPath) return;
    setPendingPath(ws.path);
    setPendingSiteUrl(ws.siteUrl);
    setPendingName(ws.name);
  };

  const handleConfirmed = useCallback(async () => {
    if (!pendingPath) return;
    const trimmed = pendingPath;
    const siteUrl = pendingSiteUrl;
    const name = pendingName;

    setPendingPath(null);
    setSaving(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/self-root/change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: trimmed, userConfirmed: true, siteUrl, name }),
      });
      const data = await res.json();
      if (data.status === 'success') {
        setFeedback({ type: 'success', msg: `Workspace verrouillé avec succès → ${data.newRoot}` });
        ideApi.invalidateCache();
        window.dispatchEvent(new CustomEvent('Leanna-sandbox-changed'));
        window.dispatchEvent(new CustomEvent('Leanna-workspace-changed', { detail: { workspace: data.newRoot } }));
        setTimeout(() => fetchStatus(), 500);
      } else {
        setFeedback({ type: 'error', msg: data.error || 'Erreur' });
      }
    } catch (e: any) {
      setFeedback({ type: 'error', msg: e.message || 'Erreur réseau' });
    } finally {
      setSaving(false);
    }
  }, [pendingPath, pendingSiteUrl, pendingName, fetchStatus]);

  const handleCancelled = useCallback(() => {
    setPendingPath(null);
    setPendingSiteUrl(undefined);
    setPendingName(undefined);
  }, []);

  const handleDeleteWorkspace = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      const res = await fetch(`/api/self-root/workspaces/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setWorkspaces(prev => prev.filter(w => w.id !== id));
      }
    } catch {
      /* ignore */
    }
  };

  const handleBrowse = async () => {
    const electronAPI = getElectronAPI();
    if (electronAPI) {
      const selected = await electronAPI.selectFolder();
      if (selected) { setPathInput(selected); setFeedback(null); }
    } else {
      try {
        // @ts-ignore — Web File System Access API
        const handle = await window.showDirectoryPicker({ mode: 'read' });
        if (handle?.name) setPathInput(handle.name);
      } catch { /* user cancelled */ }
    }
  };

  const canBrowse = !!getElectronAPI() || typeof (window as any).showDirectoryPicker === 'function';
  const isChanged = pathInput.trim() !== (status?.rootPath || '');

  return (
    <div className="space-y-6">
      <Section
        icon={Shield}
        title="Mode Multi-Workspace Sécurisé"
        description="Gestion multi-dépôts avec périmètre verrouillé et garde-fous stricts. Toutes les opérations sont strictement confinées au dépôt actif."
      >
        {/* Workspaces List */}
        <div className="space-y-2 mb-4">
          <label className="text-xs font-semibold block" style={{ color: 'var(--text-primary)' }}>
            Dépôts enregistrés ({workspaces.length})
          </label>
          <div className="space-y-1.5">
            {workspaces.map((ws) => {
              const isActive = status?.rootPath && ws.path.toLowerCase() === status.rootPath.toLowerCase();
              return (
                <div
                  key={ws.id}
                  className="flex items-center justify-between p-2.5 rounded-xl border transition-all"
                  style={{
                    backgroundColor: isActive
                      ? 'color-mix(in srgb, var(--accent-primary) 8%, var(--bg-secondary))'
                      : 'var(--bg-secondary)',
                    borderColor: isActive ? 'var(--accent-primary)' : 'var(--border-base)',
                  }}
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <div
                      className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{
                        backgroundColor: isActive
                          ? 'color-mix(in srgb, var(--accent-primary) 20%, transparent)'
                          : 'var(--bg-input)',
                        color: isActive ? 'var(--accent-primary)' : 'var(--text-muted)',
                      }}
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold truncate" style={{ color: 'var(--text-primary)' }}>
                          {ws.name}
                        </span>
                        {isActive && (
                          <span
                            className="text-[10px] font-bold px-1.5 py-0.2 rounded"
                            style={{
                              backgroundColor: 'color-mix(in srgb, var(--color-success) 15%, transparent)',
                              color: 'var(--color-success)',
                            }}
                          >
                            Actif
                          </span>
                        )}
                        {ws.isGit && (
                          <span
                            className="flex items-center gap-1 text-[10px] font-mono px-1 rounded"
                            style={{
                              backgroundColor: 'var(--bg-panel)',
                              border: '1px solid var(--border-base)',
                              color: 'var(--text-secondary)',
                            }}
                          >
                            <GitBranch className="w-2.5 h-2.5" />
                            {ws.gitBranch || 'git'}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] font-mono truncate" style={{ color: 'var(--text-dimmed)' }}>
                        {ws.path}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 pl-2 flex-shrink-0">
                    {!isActive ? (
                      <button
                        type="button"
                        onClick={() => handleSwitchWorkspace(ws)}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors shadow-sm"
                        style={{ backgroundColor: 'var(--accent-primary)', color: 'white' }}
                      >
                        Basculer
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    ) : (
                      <span className="text-xs flex items-center gap-1 text-emerald-400 font-medium px-2 py-1">
                        <CheckCircle2 className="w-3 h-3" /> Verrouillé
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={(e) => handleDeleteWorkspace(e, ws.id)}
                      className="p-1 rounded-lg opacity-40 hover:opacity-100 hover:text-red-400 transition-opacity"
                      title="Retirer de la liste"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Current path + edit */}
        <Field label="Ouvrir un nouveau dépôt" hint="Entrez le chemin absolu du dossier ou parcourez votre système de fichiers.">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <FolderOpen className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" style={{ color: 'var(--text-dimmed)' }} />
              <input
                type="text"
                value={pathInput}
                onChange={e => { setPathInput(e.target.value); setFeedback(null); }}
                onKeyDown={e => { if (e.key === 'Enter') handleSave(); }}
                placeholder="C:\Users\...\mon-projet"
                className="w-full rounded-lg border pl-8 pr-3 py-2 text-xs font-mono transition-colors focus:ring-1 focus:ring-[var(--accent-primary)]"
                style={{
                  backgroundColor: 'var(--bg-input)',
                  borderColor: 'var(--border-base)',
                  color: 'var(--text-primary)',
                  outline: 'none',
                }}
                spellCheck={false}
              />
            </div>
            {canBrowse && (
              <button
                type="button"
                onClick={handleBrowse}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors hover:opacity-80 flex-shrink-0"
                style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-base)', color: 'var(--accent-primary)' }}
                title="Parcourir"
              >
                <Upload className="w-3.5 h-3.5" />
                Parcourir
              </button>
            )}
          </div>

          {/* Save button */}
          {isChanged && (
            <motion.button
              type="button"
              onClick={handleSave}
              disabled={saving}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              whileTap={{ scale: 0.97 }}
              className="flex items-center justify-center gap-2 w-full rounded-lg py-2 mt-2 text-xs font-bold transition-all disabled:opacity-50"
              style={{ backgroundColor: 'var(--accent-primary)', color: 'white' }}
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              {saving ? 'Application…' : 'Appliquer et verrouiller le workspace'}
            </motion.button>
          )}
        </Field>

        {/* Feedback */}
        <AnimatePresence>
          {feedback && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="rounded-lg px-3 py-2 text-xs font-medium"
              style={{
                backgroundColor: feedback.type === 'success'
                  ? 'color-mix(in srgb, var(--color-success) 10%, transparent)'
                  : 'color-mix(in srgb, var(--color-error) 10%, transparent)',
                color: feedback.type === 'success' ? 'var(--color-success)' : 'var(--color-error)',
                border: `1px solid color-mix(in srgb, ${feedback.type === 'success' ? 'var(--color-success)' : 'var(--color-error)'} 25%, transparent)`,
              }}
            >
              {feedback.type === 'success' ? '✓' : '✗'} {feedback.msg}
            </motion.div>
          )}
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="rounded-lg px-3 py-2 text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/25 flex items-center gap-2"
            >
              <ShieldAlert className="w-3.5 h-3.5 flex-shrink-0" />
              <span>{error}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Active Workspace Git Info */}
        {status && status.rootPath && status.rootPath !== '(en attente du serveur)' && (
          <div
            className="flex flex-col gap-0.5 rounded-xl p-3"
            style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-base)' }}
          >
            <div className="flex items-center justify-between pb-1 mb-1 border-b" style={{ borderColor: 'var(--border-base)' }}>
              <span className="text-xs font-bold flex items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                Statut du Périmètre Actif
              </span>
              <button
                onClick={fetchStatus}
                className="flex items-center gap-1 text-[11px] font-medium transition-colors hover:opacity-80"
                style={{ color: 'var(--text-muted)' }}
              >
                <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> Rafraîchir
              </button>
            </div>
            <InfoRow label="Branche Git" value={
              <span className="flex items-center gap-1.5">
                <GitBranch className="w-3 h-3" style={{ color: 'var(--accent-primary)' }} />
                {status.gitBranch}
              </span>
            } />
            <InfoRow label="Dernier commit" value={status.lastCommit} mono />
            <InfoRow label="Date" value={status.lastCommitDate} />
            <InfoRow label="État du working tree" value={
              <span className="flex items-center gap-1.5">
                {status.gitStatus === 'clean' ? (
                  <><CheckCircle2 className="w-3 h-3 text-emerald-400" /> Propre</>
                ) : status.gitStatus === 'dirty' ? (
                  <><AlertTriangle className="w-3 h-3 text-amber-400" /> Fichiers modifiés</>
                ) : (
                  <span style={{ color: 'var(--text-dimmed)' }}>Inconnu</span>
                )}
              </span>
            } />
          </div>
        )}

        {/* Security Guardrails Recap */}
        <div
          className="rounded-xl p-3 text-xs space-y-1.5 border"
          style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-base)' }}
        >
          <div className="flex items-center gap-1.5 font-bold" style={{ color: 'var(--text-primary)' }}>
            <Lock className="w-3.5 h-3.5 text-blue-400" />
            Garde-fous de sécurité actifs
          </div>
          <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            • <strong>Isolation Sandbox</strong> : validation tsc et isolation totale avant application.<br />
            • <strong>Protection critique</strong> : confirmation obligatoire pour <code>server.ts</code>, <code>.env</code>, etc.<br />
            • <strong>Symlink Guard</strong> : blocage automatique de toute tentative de sortie de périmètre.
          </p>
        </div>
      </Section>

      {/* Confirmation modal */}
      <AnimatePresence>
        {pendingPath && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 flex items-center justify-center p-4"
            style={{ zIndex: 'var(--z-critical)' as any, backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="w-full max-w-md rounded-2xl p-6 shadow-2xl"
              style={{ backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border-base)' }}
            >
              <div className="flex items-center gap-3 mb-4">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{ backgroundColor: 'color-mix(in srgb, var(--color-warning) 15%, transparent)' }}
                >
                  <ShieldAlert className="w-5 h-5 text-amber-400" />
                </div>
                <div>
                  <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                    Changement de Workspace
                  </h3>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    Verrouiller le périmètre sur le nouveau dépôt
                  </p>
                </div>
              </div>

              <div className="rounded-xl p-3 mb-4 space-y-2 border text-xs" style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-base)' }}>
                <div>
                  <span className="text-[10px] uppercase font-bold text-muted block">Projet actuel :</span>
                  <span className="font-mono text-dimmed break-all">{status?.rootPath || '—'}</span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-primary block">Nouveau projet :</span>
                  <span className="font-mono font-bold text-primary break-all">{pendingPath}</span>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handleCancelled}
                  className="flex-1 px-4 py-2.5 rounded-xl text-xs font-semibold border transition-all"
                  style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-base)', color: 'var(--text-primary)' }}
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={handleConfirmed}
                  className="flex-1 px-4 py-2.5 rounded-xl text-xs font-semibold text-white transition-all shadow-md"
                  style={{ backgroundColor: 'var(--accent-primary)' }}
                >
                  Confirmer et activer
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
