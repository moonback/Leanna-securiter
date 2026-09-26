import React, { useState, useEffect, useCallback } from 'react';
import { RotateCcw, Shield, CheckCircle2, AlertCircle, RefreshCcw, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface Checkpoint {
  hash: string;
  date: string;
  message: string;
}

/**
 * Panneau affichant les checkpoints de l'IA et permettant rollback/validation.
 * Intégré dans l'ActivityFeed ou comme panneau dédié dans le sidebar.
 */
export const CheckpointPanel = React.memo(function CheckpointPanel() {
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<{ valid: boolean; errors?: string } | null>(null);
  const [rollbackStatus, setRollbackStatus] = useState<string | null>(null);

  const fetchCheckpoints = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/checkpoint/list');
      if (res.ok) {
        const data = await res.json();
        setCheckpoints(data.checkpoints || []);
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchCheckpoints(); }, [fetchCheckpoints]);

  const handleRollback = useCallback(async (hash: string) => {
    setRollbackStatus(null);
    try {
      const res = await fetch('/api/checkpoint/rollback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hash }),
      });
      const data = await res.json();
      setRollbackStatus(data.success ? `✓ Rollback vers ${hash.slice(0, 8)}` : `✗ Échec du rollback`);
      if (data.success) fetchCheckpoints();
    } catch (e: any) {
      setRollbackStatus(`✗ Erreur: ${e.message}`);
    }
  }, [fetchCheckpoints]);

  const handleValidate = useCallback(async () => {
    setValidating(true);
    setValidationResult(null);
    try {
      const res = await fetch('/api/checkpoint/validate', { method: 'POST' });
      const data = await res.json();
      setValidationResult(data);
    } catch (e: any) {
      setValidationResult({ valid: false, errors: e.message });
    } finally {
      setValidating(false);
    }
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3.5 border-b" style={{ height: '35px', borderColor: 'var(--border-base)' }}>
        <div className="flex items-center gap-1.5">
          <Shield size={12} style={{ color: 'var(--color-accent-alt)' }} />
          <span className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
            Checkpoints
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleValidate}
            disabled={validating}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium transition hover:bg-white/5"
            style={{ color: 'var(--color-success)' }}
            title="Valider le build (tsc)"
          >
            {validating ? <Loader2 size={10} className="animate-spin" /> : <CheckCircle2 size={10} />}
            Valider
          </button>
          <button
            onClick={fetchCheckpoints}
            className="p-1 rounded hover:bg-white/5 transition"
            title="Actualiser"
          >
            <RefreshCcw size={11} style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>
      </div>

      {/* Validation result */}
      <AnimatePresence>
        {validationResult && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div
              className="px-3.5 py-2 text-sm border-b"
              style={{
                borderColor: 'var(--border-base)',
                backgroundColor: validationResult.valid ? 'rgba(74,222,128,0.06)' : 'rgba(239,68,68,0.06)',
                color: validationResult.valid ? 'var(--color-success)' : 'var(--color-error)',
              }}
            >
              {validationResult.valid ? (
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 size={11} /> Build valide — aucune erreur TypeScript
                </span>
              ) : (
                <div>
                  <span className="flex items-center gap-1.5 font-medium">
                    <AlertCircle size={11} /> Build échoué
                  </span>
                  {validationResult.errors && (
                    <pre className="mt-1 text-xs opacity-80 whitespace-pre-wrap max-h-20 overflow-y-auto">
                      {validationResult.errors.slice(0, 500)}
                    </pre>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Rollback status */}
      {rollbackStatus && (
        <div className="px-3.5 py-1.5 text-sm border-b" style={{ borderColor: 'var(--border-base)', color: 'var(--text-muted)' }}>
          {rollbackStatus}
        </div>
      )}

      {/* Checkpoint list */}
      <div className="flex-1 overflow-y-auto py-1.5">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={14} className="animate-spin" style={{ color: 'var(--text-muted)' }} />
          </div>
        ) : checkpoints.length === 0 ? (
          <div className="text-center py-8 px-4">
            <Shield size={20} className="mx-auto mb-2 opacity-30" style={{ color: 'var(--text-muted)' }} />
            <p className="text-sm" style={{ color: 'var(--text-dimmed)' }}>
              Aucun checkpoint. Les modifications de l'IA créeront automatiquement des points de sauvegarde.
            </p>
          </div>
        ) : (
          <div className="space-y-0.5 px-1.5">
            {checkpoints.map((cp) => (
              <div
                key={cp.hash}
                className="flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-white/5 transition group"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-mono font-medium" style={{ color: 'var(--text-primary)' }}>
                      {cp.hash.slice(0, 8)}
                    </span>
                    <span className="text-xs" style={{ color: 'var(--text-dimmed)' }}>
                      {new Date(cp.date).toLocaleString('fr-FR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-xs truncate mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    {cp.message.replace('[checkpoint] ', '').replace(/^\d{4}-\d{2}.*? — /, '')}
                  </p>
                </div>
                <button
                  onClick={() => handleRollback(cp.hash)}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-white/10 transition"
                  title={`Rollback vers ${cp.hash.slice(0, 8)}`}
                >
                  <RotateCcw size={11} style={{ color: 'var(--color-warning)' }} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});
