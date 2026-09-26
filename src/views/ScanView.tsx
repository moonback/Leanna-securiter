import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  Scan, Shield, Package, Key, Server, Globe, Play, Settings2,
  FolderOpen, ChevronDown, ChevronRight, CheckCircle2, Clock,
  Loader2, AlertTriangle, X, Info
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ScanProfile {
  id: string;
  name: string;
  description: string;
  scanners: string[];
  severity_threshold: 'critical' | 'high' | 'medium' | 'low' | 'info';
}

interface ScanConfig {
  target: string;
  profile: string;
  scanners: {
    sast: boolean;
    sca: boolean;
    secrets: boolean;
    iac: boolean;
    dast: boolean;
  };
  options: {
    excludePaths: string;
    maxFiles: number;
    parallelWorkers: number;
    sarif: boolean;
  };
}

// ─── Default profiles ─────────────────────────────────────────────────────────

const SCAN_PROFILES: ScanProfile[] = [
  {
    id: 'quick',
    name: 'Analyse rapide',
    description: 'SAST + secrets uniquement, idéal pour une vérification avant commit',
    scanners: ['sast', 'secrets'],
    severity_threshold: 'high',
  },
  {
    id: 'standard',
    name: 'Audit standard',
    description: 'SAST + SCA + secrets + IaC — profil recommandé pour une PR review',
    scanners: ['sast', 'sca', 'secrets', 'iac'],
    severity_threshold: 'medium',
  },
  {
    id: 'full',
    name: 'Audit complet',
    description: 'Tous les scanners actifs — pour un audit de sécurité approfondi',
    scanners: ['sast', 'sca', 'secrets', 'iac', 'dast'],
    severity_threshold: 'low',
  },
  {
    id: 'custom',
    name: 'Personnalisé',
    description: 'Configuration manuelle des scanners et options',
    scanners: [],
    severity_threshold: 'medium',
  },
];

const SCANNER_META = [
  { id: 'sast', label: 'SAST', fullLabel: 'Analyse statique', icon: Scan, color: '#ef4444', desc: 'Taint analysis, injection patterns (SQLi, XSS, SSRF…)' },
  { id: 'sca', label: 'SCA', fullLabel: 'Supply Chain', icon: Package, color: '#f97316', desc: 'CVE, EPSS, licences, typosquatting des dépendances' },
  { id: 'secrets', label: 'Secrets', fullLabel: 'Détection de secrets', icon: Key, color: '#a855f7', desc: 'Tokens, clés API, credentials exposés dans le code' },
  { id: 'iac', label: 'IaC', fullLabel: 'Infrastructure as Code', icon: Server, color: '#3b82f6', desc: 'Dockerfile, Kubernetes, Terraform, CloudFormation' },
  { id: 'dast', label: 'DAST', fullLabel: 'Analyse dynamique', icon: Globe, color: '#22c55e', desc: 'Fuzzing API (OpenAPI), headers HTTP — opt-in explicite' },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function ScannerToggle({
  scanner,
  enabled,
  onChange,
  disabled,
}: {
  scanner: typeof SCANNER_META[number];
  enabled: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const Icon = scanner.icon;
  return (
    <motion.button
      type="button"
      onClick={() => !disabled && onChange(!enabled)}
      className="flex items-start gap-3 p-3 rounded-xl border transition-all text-left w-full"
      style={{
        borderColor: enabled ? `${scanner.color}55` : 'var(--border-base)',
        backgroundColor: enabled
          ? `color-mix(in srgb, ${scanner.color} 8%, var(--bg-panel))`
          : 'var(--bg-secondary)',
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
      whileHover={!disabled ? { scale: 1.01 } : {}}
      whileTap={!disabled ? { scale: 0.99 } : {}}
    >
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
        style={{
          backgroundColor: `${scanner.color}22`,
          border: `1px solid ${scanner.color}44`,
        }}
      >
        <Icon size={14} style={{ color: scanner.color }} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
            {scanner.fullLabel}
            <span className="ml-1.5 text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ backgroundColor: `${scanner.color}22`, color: scanner.color }}>
              {scanner.label}
            </span>
          </span>
          {/* Toggle */}
          <div
            className="relative w-8 h-4 rounded-full flex-shrink-0 transition-colors"
            style={{ backgroundColor: enabled ? scanner.color : 'var(--border-base)' }}
          >
            <motion.div
              className="absolute top-0.5 w-3 h-3 bg-white rounded-full shadow-sm"
              animate={{ x: enabled ? 17 : 2 }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            />
          </div>
        </div>
        <p className="text-[11px] mt-0.5 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          {scanner.desc}
        </p>
      </div>
    </motion.button>
  );
}

function ProfileCard({
  profile,
  selected,
  onSelect,
}: {
  profile: ScanProfile;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <motion.button
      type="button"
      onClick={onSelect}
      className="flex flex-col gap-1 p-3 rounded-xl border transition-all text-left w-full"
      style={{
        borderColor: selected ? 'var(--accent-primary)' : 'var(--border-base)',
        backgroundColor: selected
          ? 'color-mix(in srgb, var(--accent-primary) 8%, var(--bg-panel))'
          : 'var(--bg-secondary)',
      }}
      whileHover={{ scale: 1.01 }}
      whileTap={{ scale: 0.99 }}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
          {profile.name}
        </span>
        {selected && <CheckCircle2 size={13} style={{ color: 'var(--accent-primary)' }} />}
      </div>
      <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
        {profile.description}
      </p>
      {profile.scanners.length > 0 && (
        <div className="flex gap-1 flex-wrap mt-1">
          {profile.scanners.map(s => {
            const meta = SCANNER_META.find(m => m.id === s);
            return meta ? (
              <span
                key={s}
                className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                style={{ backgroundColor: `${meta.color}22`, color: meta.color }}
              >
                {meta.label}
              </span>
            ) : null;
          })}
        </div>
      )}
    </motion.button>
  );
}

// ─── Main View ────────────────────────────────────────────────────────────────

export default function ScanView() {
  const navigate = useNavigate();
  const [config, setConfig] = useState<ScanConfig>({
    target: '',
    profile: 'standard',
    scanners: { sast: true, sca: true, secrets: true, iac: true, dast: false },
    options: {
      excludePaths: 'node_modules, dist, .git, __pycache__',
      maxFiles: 1000,
      parallelWorkers: 4,
      sarif: true,
    },
  });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [scanLog, setScanLog] = useState<string[]>([]);
  const [currentWorkspace, setCurrentWorkspace] = useState<string>('');
  const [sandboxPath, setSandboxPath] = useState<string>('');
  const [sandboxActive, setSandboxActive] = useState<boolean>(false);

  // Load current workspace and sandbox target
  useEffect(() => {
    // 1. Récupérer l'état de la sandbox
    fetch('/api/sandbox/status')
      .then(r => r.json())
      .then(d => {
        if (d?.sandbox?.path) {
          setSandboxPath(d.sandbox.path);
          if (d.sandbox.active !== undefined) setSandboxActive(d.sandbox.active);
          // Par défaut la cible reprend la sandbox
          setConfig(c => ({
            ...c,
            target: c.target || d.sandbox.path,
          }));
        }
      })
      .catch(() => {});

    // 2. Récupérer le workspace actif via self-root
    fetch('/api/self-root')
      .then(r => r.json())
      .then(d => {
        const root = d.root || d.rootPath;
        if (root) setCurrentWorkspace(root);
        if (d.sandboxPath) {
          setSandboxPath(d.sandboxPath);
          setConfig(c => ({
            ...c,
            target: c.target || d.sandboxPath,
          }));
        } else if (root) {
          setConfig(c => ({
            ...c,
            target: c.target || root,
          }));
        }
      })
      .catch(() => {});
  }, []);

  // Sync scanners to selected profile
  const handleProfileSelect = useCallback((profileId: string) => {
    const profile = SCAN_PROFILES.find(p => p.id === profileId);
    if (!profile || profileId === 'custom') {
      setConfig(c => ({ ...c, profile: profileId }));
      return;
    }
    setConfig(c => ({
      ...c,
      profile: profileId,
      scanners: {
        sast: profile.scanners.includes('sast'),
        sca: profile.scanners.includes('sca'),
        secrets: profile.scanners.includes('secrets'),
        iac: profile.scanners.includes('iac'),
        dast: profile.scanners.includes('dast'),
      },
    }));
  }, []);

  const handleScannerToggle = useCallback((id: string, value: boolean) => {
    setConfig(c => ({
      ...c,
      profile: 'custom',
      scanners: { ...c.scanners, [id]: value },
    }));
  }, []);

  const activeScanners = Object.entries(config.scanners)
    .filter(([, v]) => v)
    .map(([k]) => k);

  const handleStartScan = useCallback(async () => {
    if (activeScanners.length === 0) return;
    setScanning(true);
    setScanStatus('running');
    setScanLog(['[scan] Démarrage de l\'analyse de sécurité…']);

    try {
      const target = config.target || currentWorkspace;
      const res = await fetch('/api/security/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetDir: target,
          profile: config.profile as 'quick' | 'standard' | 'full' | 'custom',
          triggerType: 'api',
          policyOverride: {
            excludePaths: config.options.excludePaths.split(',').map(s => s.trim()).filter(Boolean),
            maxFilesTotal: config.options.maxFiles,
          },
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Erreur serveur' }));
        setScanLog(l => [...l, `[error] ${err.message || 'Scan échoué'}`]);
        setScanStatus('error');
        return;
      }

      const data = await res.json();
      const totalCount = typeof data.findingsCount === 'object' ? (data.findingsCount?.total ?? data.findings?.length ?? 0) : (data.findingsCount ?? data.findings?.length ?? 0);
      setScanLog(l => [
        ...l,
        `[done] Scan terminé — ${totalCount} vulnérabilité${totalCount > 1 ? 's' : ''} détectée${totalCount > 1 ? 's' : ''}`,
        ...(data.scaOnlineEnrichment ? ['[cve] 🌐 Base CVE enrichie en direct (OSV.dev + EPSS FIRST.org + NVD)'] : []),
      ]);
      setScanStatus('done');

      // Naviguer vers la vue des vulnérabilités
      setTimeout(() => {
        navigate('/findings');
      }, 1200);
    } catch (e: any) {
      setScanLog(l => [...l, `[error] ${e.message || 'Erreur réseau'}`]);
      setScanStatus('error');
    } finally {
      setScanning(false);
    }
  }, [activeScanners, config, currentWorkspace, navigate]);

  return (
    <div
      className="h-full flex flex-col overflow-hidden"
      style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0"
        style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-panel)' }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #ef444430 0%, #7c3aed30 100%)', border: '1px solid #ef444440' }}
          >
            <Shield size={18} style={{ color: '#ef4444' }} />
          </div>
          <div>
            <h1 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>
              Lancer un scan
            </h1>
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Configurer et démarrer une analyse de sécurité
            </p>
          </div>
        </div>
        <motion.button
          type="button"
          onClick={handleStartScan}
          disabled={scanning || activeScanners.length === 0}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all"
          style={{
            background: scanning || activeScanners.length === 0
              ? 'var(--bg-secondary)'
              : 'linear-gradient(135deg, #ef4444 0%, #7c3aed 100%)',
            color: scanning || activeScanners.length === 0 ? 'var(--text-muted)' : '#fff',
            cursor: scanning || activeScanners.length === 0 ? 'not-allowed' : 'pointer',
          }}
          whileHover={!scanning && activeScanners.length > 0 ? { scale: 1.03, y: -1 } : {}}
          whileTap={!scanning && activeScanners.length > 0 ? { scale: 0.97 } : {}}
        >
          {scanning ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
          {scanning ? 'Analyse en cours…' : 'Démarrer le scan'}
        </motion.button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Scan Status Log */}
        <AnimatePresence>
          {scanLog.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="rounded-xl border p-4"
              style={{
                borderColor: scanStatus === 'error' ? '#ef444455' : scanStatus === 'done' ? '#22c55e55' : 'var(--border-base)',
                backgroundColor: scanStatus === 'error' ? '#ef444410' : scanStatus === 'done' ? '#22c55e10' : 'var(--bg-panel)',
              }}
            >
              <div className="flex items-center gap-2 mb-2">
                {scanStatus === 'running' && <Loader2 size={13} className="animate-spin" style={{ color: 'var(--accent-primary)' }} />}
                {scanStatus === 'done' && <CheckCircle2 size={13} style={{ color: '#22c55e' }} />}
                {scanStatus === 'error' && <AlertTriangle size={13} style={{ color: '#ef4444' }} />}
                <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {scanStatus === 'running' ? 'Analyse en cours' : scanStatus === 'done' ? 'Analyse terminée' : 'Erreur'}
                </span>
                {scanStatus !== 'running' && (
                  <button onClick={() => setScanLog([])} className="ml-auto">
                    <X size={12} style={{ color: 'var(--text-muted)' }} />
                  </button>
                )}
              </div>
              <div className="space-y-0.5">
                {scanLog.map((line, i) => (
                  <p key={i} className="text-[11px] font-mono" style={{ color: 'var(--text-secondary)' }}>{line}</p>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Target */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
              Cible d'analyse
            </h2>
            {sandboxPath && (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setConfig(c => ({ ...c, target: sandboxPath }))}
                  className={`text-[11px] px-2.5 py-1 rounded-md transition-all font-medium flex items-center gap-1.5 border ${
                    config.target === sandboxPath
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                      : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}
                  title="Analyser la copie isolée dans le sandbox pour un audit sans effet de bord"
                >
                  <Shield size={12} className={config.target === sandboxPath ? 'text-emerald-400' : ''} />
                  Sandbox {sandboxActive ? '(Actif)' : '(Recommandé)'}
                </button>
                {currentWorkspace && currentWorkspace !== sandboxPath && (
                  <button
                    type="button"
                    onClick={() => setConfig(c => ({ ...c, target: currentWorkspace }))}
                    className={`text-[11px] px-2.5 py-1 rounded-md transition-all font-medium flex items-center gap-1.5 border ${
                      config.target === currentWorkspace
                        ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-400'
                        : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                    }`}
                    title="Analyser directement le workspace principal"
                  >
                    <FolderOpen size={12} />
                    Workspace
                  </button>
                )}
              </div>
            )}
          </div>
          <div
            className="flex items-center gap-3 px-4 py-3 rounded-xl border transition-all"
            style={{
              borderColor: config.target === sandboxPath ? 'rgba(16, 185, 129, 0.4)' : 'var(--border-base)',
              backgroundColor: 'var(--bg-panel)',
            }}
          >
            {config.target === sandboxPath ? (
              <Shield size={16} className="text-emerald-400 flex-shrink-0" />
            ) : (
              <FolderOpen size={16} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
            )}
            <input
              type="text"
              value={config.target}
              onChange={e => setConfig(c => ({ ...c, target: e.target.value }))}
              placeholder={sandboxPath || currentWorkspace || 'Chemin vers le projet à analyser…'}
              className="flex-1 bg-transparent text-sm outline-none font-mono"
              style={{ color: 'var(--text-primary)' }}
            />
            {config.target === sandboxPath && (
              <span className="text-[10px] px-2.5 py-1 rounded-md font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                <CheckCircle2 size={11} /> Sandbox isolée
              </span>
            )}
            {config.target === currentWorkspace && config.target !== sandboxPath && (
              <span className="text-[10px] px-2.5 py-1 rounded-md font-semibold bg-cyan-500/15 text-cyan-400 border border-cyan-500/30">
                Workspace actif
              </span>
            )}
          </div>
          <p className="text-[11px] mt-2 ml-1 flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
            <Info size={11} className="flex-shrink-0" />
            {config.target === sandboxPath ? (
              <span>L'audit s'exécute en mode <strong className="text-emerald-400 font-semibold">sandbox isolé</strong> : vos fichiers sources sont protégés contre tout effet de bord.</span>
            ) : (
              <span>Chemin direct du code source à auditer. Cliquez sur <strong>Sandbox (Recommandé)</strong> pour analyser la copie isolée.</span>
            )}
          </p>
        </section>

        {/* Profiles */}
        <section>
          <h2 className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>
            Profil de scan
          </h2>
          <div className="grid grid-cols-2 gap-2">
            {SCAN_PROFILES.map(profile => (
              <ProfileCard
                key={profile.id}
                profile={profile}
                selected={config.profile === profile.id}
                onSelect={() => handleProfileSelect(profile.id)}
              />
            ))}
          </div>
        </section>

        {/* Scanners */}
        <section>
          <h2 className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>
            Scanners actifs
            <span className="ml-2 font-normal normal-case text-[11px]" style={{ color: 'var(--accent-primary)' }}>
              {activeScanners.length} / {SCANNER_META.length} activés
            </span>
          </h2>
          <div className="space-y-2">
            {SCANNER_META.map(scanner => (
              <ScannerToggle
                key={scanner.id}
                scanner={scanner}
                enabled={config.scanners[scanner.id as keyof typeof config.scanners]}
                onChange={v => handleScannerToggle(scanner.id, v)}
                disabled={scanner.id === 'dast' && !config.scanners.dast && config.profile !== 'full' && config.profile !== 'custom'}
              />
            ))}
          </div>
          {!config.scanners.dast && (
            <p className="text-[11px] mt-2 ml-1 flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
              <AlertTriangle size={10} style={{ color: '#f97316' }} />
              Le scanner DAST est désactivé par défaut — nécessite un opt-in explicite (profil Complet ou Personnalisé)
            </p>
          )}
        </section>

        {/* Advanced options */}
        <section>
          <button
            type="button"
            onClick={() => setShowAdvanced(v => !v)}
            className="flex items-center gap-2 text-xs font-semibold transition-colors"
            style={{ color: 'var(--text-secondary)' }}
          >
            <Settings2 size={13} />
            Options avancées
            {showAdvanced ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>

          <AnimatePresence>
            {showAdvanced && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div
                  className="mt-3 p-4 rounded-xl border space-y-4"
                  style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-panel)' }}
                >
                  <div>
                    <label className="text-[11px] font-medium block mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                      Dossiers exclus
                    </label>
                    <input
                      type="text"
                      value={config.options.excludePaths}
                      onChange={e => setConfig(c => ({ ...c, options: { ...c.options, excludePaths: e.target.value } }))}
                      className="w-full px-3 py-2 rounded-lg border text-xs font-mono outline-none"
                      style={{
                        borderColor: 'var(--border-base)',
                        backgroundColor: 'var(--bg-secondary)',
                        color: 'var(--text-primary)',
                      }}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[11px] font-medium block mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                        Fichiers max
                      </label>
                      <input
                        type="number"
                        value={config.options.maxFiles}
                        onChange={e => setConfig(c => ({ ...c, options: { ...c.options, maxFiles: +e.target.value } }))}
                        className="w-full px-3 py-2 rounded-lg border text-xs outline-none"
                        style={{
                          borderColor: 'var(--border-base)',
                          backgroundColor: 'var(--bg-secondary)',
                          color: 'var(--text-primary)',
                        }}
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-medium block mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                        Workers parallèles
                      </label>
                      <input
                        type="number"
                        value={config.options.parallelWorkers}
                        onChange={e => setConfig(c => ({ ...c, options: { ...c.options, parallelWorkers: +e.target.value } }))}
                        className="w-full px-3 py-2 rounded-lg border text-xs outline-none"
                        style={{
                          borderColor: 'var(--border-base)',
                          backgroundColor: 'var(--bg-secondary)',
                          color: 'var(--text-primary)',
                        }}
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setConfig(c => ({ ...c, options: { ...c.options, sarif: !c.options.sarif } }))}
                      className="relative w-8 h-4 rounded-full transition-colors"
                      style={{ backgroundColor: config.options.sarif ? 'var(--accent-primary)' : 'var(--border-base)' }}
                    >
                      <motion.div
                        className="absolute top-0.5 w-3 h-3 bg-white rounded-full shadow-sm"
                        animate={{ x: config.options.sarif ? 17 : 2 }}
                        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                      />
                    </button>
                    <div>
                      <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>Export SARIF 2.1.0</span>
                      <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                        Générer un rapport SARIF compatible GitHub Code Scanning / VS Code
                      </p>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        {/* Summary */}
        <div
          className="rounded-xl border p-4 flex items-center gap-4"
          style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-panel)' }}
        >
          <Clock size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <div>
            <p className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
              Durée estimée :
              <span style={{ color: 'var(--accent-primary)' }}>
                {activeScanners.length === 0 ? ' —'
                  : activeScanners.length === 1 ? ' ~30 secondes'
                  : activeScanners.length <= 3 ? ' ~1–3 minutes'
                  : ' ~3–8 minutes'}
              </span>
            </p>
            <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {activeScanners.length} scanner(s) actif(s) · Export SARIF {config.options.sarif ? 'activé' : 'désactivé'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
