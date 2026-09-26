import { useState, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { ShieldCheck, History, FileWarning, RotateCcw, Play, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { Section, Field, ToggleSwitch } from './SettingsPrimitives.js';
import { AutonomyLevelSelector } from '../autonomy/AutonomyLevelSelector.js';
import { useSafeguardsConfig, type SafeguardsConfig } from '../../hooks/useSafeguardsConfig.js';

interface Checkpoint {
  hash: string;
  message: string;
  date: string;
}

export function SafeguardsSection() {
  const { config, update } = useSafeguardsConfig();
  const saveConfig = (next: SafeguardsConfig) => { void update(next); };
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [loadingCheckpoints, setLoadingCheckpoints] = useState(false);
  const [validationStatus, setValidationStatus] = useState<'idle' | 'running' | 'pass' | 'fail'>('idle');
  const hasFetched = useRef(false);

  useEffect(() => {
    if (hasFetched.current) return;
    hasFetched.current = true;
    fetchCheckpoints();
  }, []);

  const fetchCheckpoints = async () => {
    setLoadingCheckpoints(true);
    try {
      const res = await fetch('/api/safeguards/checkpoints?limit=5');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.checkpoints)) setCheckpoints(data.checkpoints);
      }
    } catch { setCheckpoints([]); }
    finally { setLoadingCheckpoints(false); }
  };

  const runValidation = async () => {
    setValidationStatus('running');
    try {
      const res = await fetch('/api/safeguards/validate', { method: 'POST' });
      const data = await res.json();
      setValidationStatus(data.success ? 'pass' : 'fail');
    } catch {
      setValidationStatus('fail');
    }
    setTimeout(() => setValidationStatus('idle'), 5000);
  };

  const rollbackTo = async (hash: string) => {
    if (!confirm(`Revenir au checkpoint ${hash.slice(0, 7)} ? Cette action est irréversible.`)) return;
    try {
      await fetch('/api/safeguards/rollback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hash }),
      });
      fetchCheckpoints();
    } catch { /* handled by UI */ }
  };

  return (
    <Section
      icon={ShieldCheck}
      title="Garde-fous auto-modification"
      description="Protections actives quand l'IA modifie son propre code source"
      badge="PHASE 2"
    >
      {/* ─── Niveau d'autonomie ─── */}
      <Field
        label="Niveau d'autonomie"
        hint="Détermine jusqu'où l'IA peut agir seule avant de demander votre aval."
      >
        <AutonomyLevelSelector
          value={config.autonomyLevel ?? 'manual'}
          onChange={level => saveConfig({ ...config, autonomyLevel: level })}
        />
      </Field>

      {/* ─── Toggles ─── */}
      <div className="flex flex-col gap-1">
        <ToggleSwitch
          value={config.autoCheckpoint}
          onChange={v => saveConfig({ ...config, autoCheckpoint: v })}
          label="Checkpoint automatique"
          hint="Commit git local avant chaque écriture de fichier par l'IA"
        />
        <ToggleSwitch
          value={config.postEditValidation}
          onChange={v => saveConfig({ ...config, postEditValidation: v })}
          label="Validation post-édition"
          hint="Lance tsc + tests après chaque série de modifications"
        />
        <ToggleSwitch
          value={config.criticalFileConfirm}
          onChange={v => saveConfig({ ...config, criticalFileConfirm: v })}
          label="Confirmation fichiers critiques"
          hint="Demande une validation utilisateur avant de modifier un fichier sensible"
        />
        <ToggleSwitch
          value={config.autoRestart}
          onChange={v => saveConfig({ ...config, autoRestart: v })}
          label="Redémarrage contrôlé"
          hint="Relance automatiquement le serveur après une modification du backend"
        />
      </div>

      {/* ─── Critical files list ─── */}
      <Field label="Fichiers critiques" hint="Modifications soumises à confirmation explicite">
        <div className="flex flex-wrap gap-1.5">
          {config.criticalFiles.map(file => (
            <span
              key={file}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-mono"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--color-warning) 10%, transparent)',
                border: '1px solid color-mix(in srgb, var(--color-warning) 25%, transparent)',
                color: 'var(--color-warning)',
              }}
            >
              <FileWarning className="w-3 h-3" />
              {file}
            </span>
          ))}
        </div>
      </Field>

      {/* ─── Manual validation trigger ─── */}
      <Field label="Validation manuelle" hint="Lancer une vérification immédiate (tsc --noEmit + tests)">
        <motion.button
          type="button"
          onClick={runValidation}
          disabled={validationStatus === 'running'}
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.98 }}
          className="flex items-center justify-center gap-2 w-full rounded-xl px-4 py-3 text-xs font-semibold transition-all duration-200 disabled:opacity-60"
          style={{
            backgroundColor: validationStatus === 'pass'
              ? 'color-mix(in srgb, var(--color-success) 12%, transparent)'
              : validationStatus === 'fail'
              ? 'color-mix(in srgb, var(--color-error) 12%, transparent)'
              : 'var(--bg-secondary)',
            border: `1px solid ${
              validationStatus === 'pass' ? 'color-mix(in srgb, var(--color-success) 30%, transparent)'
              : validationStatus === 'fail' ? 'color-mix(in srgb, var(--color-error) 30%, transparent)'
              : 'var(--border-base)'
            }`,
            color: validationStatus === 'pass' ? 'var(--color-success)'
              : validationStatus === 'fail' ? 'var(--color-error)'
              : 'var(--text-primary)',
          }}
        >
          {validationStatus === 'running' && (
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
              className="w-3.5 h-3.5 border-2 rounded-full"
              style={{ borderColor: 'var(--accent-primary)', borderTopColor: 'transparent' }}
            />
          )}
          {validationStatus === 'idle' && <Play className="w-3.5 h-3.5" />}
          {validationStatus === 'pass' && <CheckCircle2 className="w-3.5 h-3.5" />}
          {validationStatus === 'fail' && <XCircle className="w-3.5 h-3.5" />}
          {validationStatus === 'running' ? 'Vérification en cours…'
            : validationStatus === 'pass' ? 'Build & tests OK ✓'
            : validationStatus === 'fail' ? 'Échec — voir les logs'
            : 'Lancer la vérification'}
        </motion.button>
      </Field>

      {/* ─── Recent Checkpoints ─── */}
      <Field label="Checkpoints récents" hint="Derniers snapshots créés par l'IA avant modification">
        <div className="rounded-xl p-3 max-h-52 overflow-y-auto custom-scrollbar"
          style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-base)' }}>
          {loadingCheckpoints && (
            <div className="flex items-center gap-2 py-3 justify-center">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
                className="w-3.5 h-3.5 border-2 rounded-full"
                style={{ borderColor: 'var(--accent-primary)', borderTopColor: 'transparent' }}
              />
              <span className="text-sm" style={{ color: 'var(--text-dimmed)' }}>Chargement…</span>
            </div>
          )}
          {!loadingCheckpoints && checkpoints.length === 0 && (
            <p className="text-sm text-center py-3" style={{ color: 'var(--text-dimmed)' }}>
              Aucun checkpoint disponible.
            </p>
          )}
          {!loadingCheckpoints && checkpoints.length > 0 && (
            <ul className="space-y-1.5">
              {checkpoints.map((cp, idx) => (
                <motion.li
                  key={cp.hash}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.03 }}
                  className="flex items-center justify-between gap-2 rounded-lg p-2.5"
                  style={{ backgroundColor: 'var(--bg-base)', border: '1px solid var(--border-base)' }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <History className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--accent-primary)' }} />
                      <span className="text-sm font-mono font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                        {cp.hash.slice(0, 7)}
                      </span>
                    </div>
                    <p className="text-xs mt-0.5 truncate pl-5" style={{ color: 'var(--text-muted)' }}>
                      {cp.message}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <span className="text-xs font-mono" style={{ color: 'var(--text-dimmed)' }}>
                      <Clock className="w-2.5 h-2.5 inline mr-0.5" />
                      {cp.date ? new Date(cp.date).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
                    </span>
                    <button
                      type="button"
                      onClick={() => rollbackTo(cp.hash)}
                      className="p-1 rounded-md transition-colors hover:bg-[color-mix(in_srgb,var(--color-warning)_12%,transparent)]"
                      title="Revenir à ce checkpoint"
                    >
                      <RotateCcw className="w-3 h-3" style={{ color: 'var(--color-warning)' }} />
                    </button>
                  </div>
                </motion.li>
              ))}
            </ul>
          )}
        </div>
      </Field>
    </Section>
  );
}
