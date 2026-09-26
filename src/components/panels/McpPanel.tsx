import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Plug, Plus, Trash2, RefreshCw, Power, PowerOff,
  Terminal, Globe, AlertCircle, CheckCircle2, Loader2, Wrench,
  ChevronDown, ChevronRight, X, Activity, Clock,
  Zap, TrendingUp, Search
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

interface McpTool {
  name: string;
  description?: string;
  inputSchema: any;
  _mcpServerId: string;
}

interface McpServer {
  id: string;
  name: string;
  transport: 'stdio' | 'sse';
  status: 'disconnected' | 'connecting' | 'ready' | 'error';
  tools: McpTool[];
  error: string | null;
  disabled: boolean;
}

interface McpMetric {
  toolName: string;
  serverId: string;
  durationMs: number;
  success: boolean;
  error?: string;
  timestamp: number;
}

interface McpMetricsSummary {
  [serverId: string]: { calls: number; errors: number; avgMs: number };
}

interface NewServerForm {
  id: string;
  name: string;
  transport: 'stdio' | 'sse';
  command: string;
  args: string;
  url: string;
  env: string;
  description: string;
  tags: string;
  timeout: string;
  maxRetries: string;
}

type TabId = 'servers' | 'metrics';

const EMPTY_FORM: NewServerForm = {
  id: '', name: '', transport: 'stdio',
  command: '', args: '', url: '', env: '', description: '',
  tags: '', timeout: '', maxRetries: ''
};

// ── Inline styles matching splash.html design language ────────────────────────
const theme = {
  bg: 'var(--bg-base)',
  card: 'var(--bg-panel)',
  border: 'var(--border-base)',
  textHi: 'var(--text-primary)',
  textDim: 'var(--text-secondary)',
  textFaint: 'var(--text-muted)',
  textGhost: 'var(--text-dimmed)',
  accent: 'var(--accent-primary)',
  accentHover: 'var(--accent-hover)',
  accentDim: 'var(--accent-subtle)',
  success: 'var(--color-success)',
  error: 'var(--color-error)',
  warning: 'var(--color-warning)',
  input: 'var(--bg-input)',
  mono: "'SFMono-Regular', 'IBM Plex Mono', ui-monospace, Menlo, Consolas, monospace",
};

// ═══════════════════════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════════════════════

export function McpPanel() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState<NewServerForm>(EMPTY_FORM);
  const [expandedServers, setExpandedServers] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonInput, setJsonInput] = useState('');
  const [activeTab, setActiveTab] = useState<TabId>('servers');
  const [metrics, setMetrics] = useState<McpMetric[]>([]);
  const [metricsSummary, setMetricsSummary] = useState<McpMetricsSummary>({});
  const [toolSearch, setToolSearch] = useState('');

  const apiBase = '/api/mcp';

  const fetchServers = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/servers`, {
        headers: { 'X-Leanna-Token': localStorage.getItem('Leanna_api_token') || '' }
      });
      const data = await res.json();
      if (data.status === 'success') {
        setServers(data.servers);
        setError(null);
      } else {
        setError(data.error || 'Erreur inconnue');
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchServers();
    const interval = setInterval(fetchServers, 10_000);
    return () => clearInterval(interval);
  }, [fetchServers]);

  const fetchMetrics = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/metrics`, {
        headers: { 'X-Leanna-Token': localStorage.getItem('Leanna_api_token') || '' }
      });
      const data = await res.json();
      if (data.status === 'success') {
        setMetrics(data.metrics || []);
        setMetricsSummary(data.summary || {});
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    if (activeTab === 'metrics') {
      fetchMetrics();
      const interval = setInterval(fetchMetrics, 15_000);
      return () => clearInterval(interval);
    }
  }, [activeTab, fetchMetrics]);

  // Computed: total tools count
  const totalTools = useMemo(() => servers.reduce((acc, s) => acc + s.tools.length, 0), [servers]);
  const readyCount = useMemo(() => servers.filter(s => s.status === 'ready').length, [servers]);

  const toggleExpand = (id: string) => {
    setExpandedServers(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleToggle = async (id: string, currentlyDisabled: boolean) => {
    await fetch(`${apiBase}/servers/${id}/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Leanna-Token': localStorage.getItem('Leanna_api_token') || '' },
      body: JSON.stringify({ enabled: currentlyDisabled }),
    });
    fetchServers();
  };

  const handleReconnect = async (id: string) => {
    await fetch(`${apiBase}/servers/${id}/reconnect`, {
      method: 'POST',
      headers: { 'X-Leanna-Token': localStorage.getItem('Leanna_api_token') || '' },
    });
    fetchServers();
  };

  const handleDelete = async (id: string) => {
    if (!confirm(`Supprimer le serveur MCP "${id}" ?`)) return;
    await fetch(`${apiBase}/servers/${id}`, {
      method: 'DELETE',
      headers: { 'X-Leanna-Token': localStorage.getItem('Leanna_api_token') || '' },
    });
    fetchServers();
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const body: any = {
        id: form.id.trim().replace(/\s+/g, '-').toLowerCase(),
        name: form.name.trim(),
        transport: form.transport,
        description: form.description.trim() || undefined,
      };

      if (form.transport === 'stdio') {
        body.command = form.command.trim();
        body.args = form.args.trim() ? form.args.split(/\s+/) : [];
      } else {
        body.url = form.url.trim();
      }

      if (form.env.trim()) {
        try {
          body.env = JSON.parse(form.env);
        } catch {
          setError('Variables d\'env invalides (JSON attendu)');
          setSubmitting(false);
          return;
        }
      }

      // Nouveaux champs optionnels
      if (form.tags.trim()) {
        body.tags = form.tags.split(',').map((t: string) => t.trim()).filter(Boolean);
      }
      if (form.timeout.trim()) {
        const t = parseInt(form.timeout, 10);
        if (!isNaN(t) && t > 0) body.timeout = t;
      }
      if (form.maxRetries.trim()) {
        const r = parseInt(form.maxRetries, 10);
        if (!isNaN(r) && r >= 0) body.maxRetries = r;
      }

      const res = await fetch(`${apiBase}/servers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Leanna-Token': localStorage.getItem('Leanna_api_token') || '' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setForm(EMPTY_FORM);
        setShowAddForm(false);
        fetchServers();
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddFromJson = async () => {
    const raw = jsonInput.trim();
    if (!raw) {
      setError('Collez un JSON de configuration MCP');
      return;
    }

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      setError('JSON invalide — vérifiez la syntaxe');
      return;
    }

    // Support both formats:
    // 1. { "mcpServers": { "id": { ... } } }
    // 2. { "id": { "command": ..., "args": [...] } }
    let serversObj: Record<string, any> = {};

    if (parsed.mcpServers && typeof parsed.mcpServers === 'object') {
      serversObj = parsed.mcpServers;
    } else if (parsed.command || parsed.url || parsed.args) {
      // Single server without ID wrapper — ask for an id
      setError('JSON d\'un seul serveur détecté — enveloppez-le : { "mon-serveur": { ... } }');
      return;
    } else {
      // Assume it's { "id": { config } } format
      const keys = Object.keys(parsed);
      if (keys.length === 0) {
        setError('Aucun serveur trouvé dans le JSON');
        return;
      }
      // Validate at least one looks like a server config
      const first = parsed[keys[0]];
      if (typeof first === 'object' && (first.command || first.url || first.args)) {
        serversObj = parsed;
      } else {
        setError('Format non reconnu — attendu : { "mcpServers": { ... } } ou { "id": { "command": ... } }');
        return;
      }
    }

    setSubmitting(true);
    let addedCount = 0;
    let lastError: string | null = null;

    for (const [id, config] of Object.entries(serversObj)) {
      if (typeof config !== 'object' || config === null) continue;

      const cfg = config as any;
      const isDisabled = cfg.disabled === true;
      const transport = cfg.url ? 'sse' : 'stdio';

      const body: any = {
        id: id.trim().replace(/\s+/g, '-').toLowerCase(),
        name: cfg.name || id,
        transport,
      };

      if (transport === 'stdio') {
        body.command = cfg.command || '';
        body.args = Array.isArray(cfg.args) ? cfg.args : [];
      } else {
        body.url = cfg.url || '';
      }

      if (cfg.env && typeof cfg.env === 'object') {
        body.env = cfg.env;
      }

      if (cfg.description) body.description = cfg.description;
      if (cfg.timeout) body.timeout = cfg.timeout;
      if (cfg.maxRetries !== undefined) body.maxRetries = cfg.maxRetries;
      if (isDisabled) body.disabled = true;
      if (cfg.autoApprove) body.autoApprove = cfg.autoApprove;

      try {
        const res = await fetch(`${apiBase}/servers`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Leanna-Token': localStorage.getItem('Leanna_api_token') || '' },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (data.error) {
          lastError = `${id}: ${data.error}`;
        } else {
          addedCount++;
        }
      } catch (e: any) {
        lastError = `${id}: ${e.message}`;
      }
    }

    setSubmitting(false);

    if (addedCount > 0) {
      setJsonInput('');
      setShowAddForm(false);
      setJsonMode(false);
      fetchServers();
    }

    if (lastError) {
      setError(addedCount > 0
        ? `${addedCount} ajouté(s), erreur: ${lastError}`
        : lastError
      );
    }
  };

  const statusIcon = (status: McpServer['status']) => {
    switch (status) {
      case 'ready': return <CheckCircle2 size={13} style={{ color: theme.success }} />;
      case 'connecting': return <Loader2 size={13} style={{ color: theme.warning }} className="animate-spin" />;
      case 'error': return <AlertCircle size={13} style={{ color: theme.error }} />;
      default: return <PowerOff size={13} style={{ color: theme.textGhost }} />;
    }
  };

  const statusLabel = (status: McpServer['status']) => {
    switch (status) {
      case 'ready': return 'ok';
      case 'connecting': return '...';
      case 'error': return 'err';
      default: return 'off';
    }
  };

  // ── Shared input style ──────────────────────────────────────────────────────
  const inputStyle: React.CSSProperties = {
    backgroundColor: theme.input,
    border: `1px solid ${theme.border}`,
    color: theme.textHi,
    fontFamily: theme.mono,
    fontSize: 11,
    borderRadius: 3,
    padding: '6px 8px',
    outline: 'none',
    width: '100%',
  };

  return (
    <div
      className="flex flex-col h-full overflow-hidden"
      style={{ backgroundColor: theme.bg, color: theme.textHi, fontFamily: theme.mono }}
    >
      {/* ── Header ── */}
      <div
        className="flex items-center justify-between px-4 py-3 shrink-0"
        style={{ borderBottom: `1px solid ${theme.border}` }}
      >
        <div className="flex items-center gap-2">
          <Plug size={16} style={{ color: theme.accent }} />
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: 1.5, color: theme.textHi }}>
            MCP
          </span>
          <span style={{ fontSize: 10, color: theme.textGhost, letterSpacing: 0.5 }}>
            {readyCount}/{servers.length} · {totalTools} outils
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={fetchServers}
            className="p-1.5 rounded"
            style={{ color: theme.textFaint }}
            title="Rafraîchir"
          >
            <RefreshCw size={13} />
          </button>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="p-1.5 rounded"
            style={{ color: theme.accent }}
            title="Ajouter un serveur"
          >
            {showAddForm ? <X size={13} /> : <Plus size={13} />}
          </button>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div
        className="flex shrink-0"
        style={{ borderBottom: `1px solid ${theme.border}` }}
      >
        {([
          { id: 'servers' as TabId, label: 'Serveurs', icon: <Plug size={11} /> },
          { id: 'metrics' as TabId, label: 'Métriques', icon: <Activity size={11} /> },
        ]).map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="flex items-center gap-1.5 px-4 py-2"
            style={{
              fontSize: 11,
              fontWeight: activeTab === tab.id ? 600 : 400,
              color: activeTab === tab.id ? theme.accent : theme.textFaint,
              borderBottom: activeTab === tab.id ? `2px solid ${theme.accent}` : '2px solid transparent',
              background: 'none',
              border: 'none',
              borderBottomWidth: 2,
              borderBottomStyle: 'solid',
              borderBottomColor: activeTab === tab.id ? theme.accent : 'transparent',
              cursor: 'pointer',
            }}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div
          className="px-4 py-2 flex items-center gap-2"
          style={{
            fontSize: 11,
            backgroundColor: theme.accentDim,
            borderBottom: `1px solid ${theme.border}`,
            color: theme.error,
          }}
        >
          <AlertCircle size={11} />
          <span className="flex-1 truncate">{error}</span>
          <button onClick={() => setError(null)} style={{ color: theme.error }}>
            <X size={11} />
          </button>
        </div>
      )}

      {/* ── Add Server Form ── */}
      <AnimatePresence>
        {showAddForm && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
            style={{ borderBottom: `1px solid ${theme.border}` }}
          >
            <div className="p-4 space-y-2.5">
              {/* ── Mode toggle: Formulaire / JSON ── */}
              <div className="flex items-center gap-2" style={{ fontSize: 10, color: theme.textFaint }}>
                <button
                  type="button"
                  onClick={() => setJsonMode(false)}
                  style={{
                    fontSize: 10,
                    fontWeight: !jsonMode ? 600 : 400,
                    color: !jsonMode ? theme.accent : theme.textFaint,
                    background: !jsonMode ? theme.accentDim : 'none',
                    border: `1px solid ${!jsonMode ? theme.accent : theme.border}`,
                    borderRadius: 3,
                    padding: '3px 8px',
                    cursor: 'pointer',
                  }}
                >
                  formulaire
                </button>
                <button
                  type="button"
                  onClick={() => setJsonMode(true)}
                  style={{
                    fontSize: 10,
                    fontWeight: jsonMode ? 600 : 400,
                    color: jsonMode ? theme.accent : theme.textFaint,
                    background: jsonMode ? theme.accentDim : 'none',
                    border: `1px solid ${jsonMode ? theme.accent : theme.border}`,
                    borderRadius: 3,
                    padding: '3px 8px',
                    cursor: 'pointer',
                  }}
                >
                  coller JSON
                </button>
              </div>

              {jsonMode ? (
                /* ── JSON paste mode ── */
                <>
                  <textarea
                    style={{
                      ...inputStyle,
                      minHeight: 140,
                      resize: 'vertical',
                      lineHeight: 1.4,
                    }}
                    placeholder={`Collez votre JSON MCP ici, ex:\n{\n  "mcpServers": {\n    "mon-serveur": {\n      "command": "uvx",\n      "args": ["package@latest"],\n      "env": { "KEY": "val" }\n    }\n  }\n}`}
                    value={jsonInput}
                    onChange={e => setJsonInput(e.target.value)}
                    spellCheck={false}
                  />
                  <p style={{ fontSize: 10, color: theme.textGhost, lineHeight: 1.4 }}>
                    Formats acceptés : <code style={{ color: theme.textFaint }}>{'{ "mcpServers": { ... } }'}</code> ou <code style={{ color: theme.textFaint }}>{'{ "id": { "command": ... } }'}</code>
                  </p>
                  <button
                    type="button"
                    onClick={handleAddFromJson}
                    disabled={submitting}
                    className="w-full rounded disabled:opacity-50"
                    style={{
                      padding: '7px 0',
                      fontSize: 11,
                      fontWeight: 600,
                      letterSpacing: 0.5,
                      backgroundColor: theme.accent,
                      color: 'white',
                      border: 'none',
                      borderRadius: 3,
                      cursor: 'pointer',
                    }}
                  >
                    {submitting ? 'import...' : 'importer depuis JSON'}
                  </button>
                </>
              ) : (
                /* ── Classic form mode ── */
                <form onSubmit={handleAdd} className="space-y-2.5">
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      style={inputStyle}
                      placeholder="id (ex: my-server)"
                      value={form.id}
                      onChange={e => setForm({ ...form, id: e.target.value })}
                      required
                    />
                    <input
                      style={inputStyle}
                      placeholder="Nom affiché"
                      value={form.name}
                      onChange={e => setForm({ ...form, name: e.target.value })}
                      required
                    />
                  </div>

                  <div className="flex gap-4" style={{ fontSize: 11, color: theme.textDim }}>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio" name="transport" value="stdio"
                        checked={form.transport === 'stdio'}
                        onChange={() => setForm({ ...form, transport: 'stdio' })}
                        style={{ accentColor: theme.accent }}
                      />
                      <Terminal size={11} /> stdio
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio" name="transport" value="sse"
                        checked={form.transport === 'sse'}
                        onChange={() => setForm({ ...form, transport: 'sse' })}
                        style={{ accentColor: theme.accent }}
                      />
                      <Globe size={11} /> sse
                    </label>
                  </div>

                  {form.transport === 'stdio' ? (
                    <>
                      <input
                        style={inputStyle}
                        placeholder="commande (uvx, npx, node...)"
                        value={form.command}
                        onChange={e => setForm({ ...form, command: e.target.value })}
                        required
                      />
                      <input
                        style={inputStyle}
                        placeholder="arguments (séparés par espaces)"
                        value={form.args}
                        onChange={e => setForm({ ...form, args: e.target.value })}
                      />
                    </>
                  ) : (
                    <input
                      style={inputStyle}
                      placeholder="url endpoint SSE"
                      value={form.url}
                      onChange={e => setForm({ ...form, url: e.target.value })}
                      required
                    />
                  )}

                  <input
                    style={inputStyle}
                    placeholder={'env (JSON: {"KEY": "val"})'}
                    value={form.env}
                    onChange={e => setForm({ ...form, env: e.target.value })}
                  />

                  <input
                    style={inputStyle}
                    placeholder="description (optionnel)"
                    value={form.description}
                    onChange={e => setForm({ ...form, description: e.target.value })}
                  />

                  {/* ── Paramètres avancés ── */}
                  <div className="grid grid-cols-3 gap-2">
                    <input
                      style={inputStyle}
                      placeholder="tags (csv)"
                      value={form.tags}
                      onChange={e => setForm({ ...form, tags: e.target.value })}
                      title="Tags séparés par virgule (ex: docs,api)"
                    />
                    <input
                      style={inputStyle}
                      placeholder="timeout (ms)"
                      value={form.timeout}
                      onChange={e => setForm({ ...form, timeout: e.target.value })}
                      title="Timeout en millisecondes (défaut: 30000)"
                    />
                    <input
                      style={inputStyle}
                      placeholder="retries (0-10)"
                      value={form.maxRetries}
                      onChange={e => setForm({ ...form, maxRetries: e.target.value })}
                      title="Nombre max de reconnexions (défaut: 5, 0=désactivé)"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full rounded disabled:opacity-50"
                    style={{
                      padding: '7px 0',
                      fontSize: 11,
                      fontWeight: 600,
                      letterSpacing: 0.5,
                      backgroundColor: theme.accent,
                      color: 'white',
                      border: 'none',
                      borderRadius: 3,
                      cursor: 'pointer',
                    }}
                  >
                    {submitting ? 'connexion...' : 'ajouter et connecter'}
                  </button>
                </form>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Server List (boot-log style) ── */}
      <div className="flex-1 overflow-y-auto">
       {activeTab === 'servers' && (
        <>
        {/* ── Tool search bar ── */}
        {servers.some(s => s.tools.length > 0) && (
          <div className="px-3 pt-3">
            <div className="relative">
              <Search size={11} style={{ position: 'absolute', left: 8, top: 7, color: theme.textGhost }} />
              <input
                style={{ ...inputStyle, paddingLeft: 24 }}
                placeholder="rechercher un outil..."
                value={toolSearch}
                onChange={e => setToolSearch(e.target.value)}
              />
              {toolSearch && (
                <button
                  onClick={() => setToolSearch('')}
                  style={{ position: 'absolute', right: 6, top: 6, color: theme.textGhost }}
                >
                  <X size={11} />
                </button>
              )}
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center p-8" style={{ color: theme.textGhost }}>
            <Loader2 size={18} className="animate-spin" />
          </div>
        ) : servers.length === 0 ? (
          <div className="p-6 text-center" style={{ color: theme.textFaint, fontSize: 11 }}>
            <Plug size={28} className="mx-auto mb-3 opacity-30" />
            <p>aucun serveur MCP configuré</p>
            <p style={{ color: theme.textGhost, marginTop: 4 }}>
              + pour brancher un serveur d'outils
            </p>
          </div>
        ) : (
          <div
            className="mx-3 my-3 rounded overflow-hidden"
            style={{
              background: theme.card,
              border: `1px solid ${theme.border}`,
              borderRadius: 3,
              boxShadow: 'var(--shadow-xs)',
            }}
          >
            {servers.map((server, idx) => (
              <div
                key={server.id}
                className="group"
                style={{ borderTop: idx > 0 ? `1px solid ${theme.border}` : undefined }}
              >
                {/* Server row — boot-log aesthetic */}
                <div
                  className="flex items-center gap-2 px-3 py-2 cursor-pointer"
                  onClick={() => toggleExpand(server.id)}
                  style={{ fontSize: 12 }}
                >
                  {expandedServers.has(server.id) ? (
                    <ChevronDown size={11} style={{ color: theme.textGhost }} />
                  ) : (
                    <ChevronRight size={11} style={{ color: theme.textGhost }} />
                  )}

                  {statusIcon(server.status)}

                  {/* Label */}
                  <span
                    className="truncate"
                    style={{
                      color: server.status === 'ready' ? theme.textDim : theme.textFaint,
                      fontWeight: server.status === 'ready' ? 500 : 400,
                    }}
                  >
                    {server.name}
                  </span>

                  {/* Fill dots (like splash boot log) */}
                  <span className="flex-1 overflow-hidden truncate" style={{ color: theme.textGhost, letterSpacing: 1 }}>
                    {'·'.repeat(20)}
                  </span>

                  {/* Transport badge */}
                  <span style={{ fontSize: 10, color: theme.textGhost }}>
                    {server.transport}
                  </span>

                  {/* Status text */}
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      minWidth: 24,
                      textAlign: 'right',
                      color: server.status === 'ready' ? theme.accent
                           : server.status === 'error' ? theme.error
                           : theme.textGhost,
                    }}
                  >
                    {statusLabel(server.status)}
                  </span>

                  {/* Hover actions */}
                  <div className="hidden group-hover:flex items-center gap-0.5 ml-1" onClick={e => e.stopPropagation()}>
                    <button
                      onClick={() => handleReconnect(server.id)}
                      className="p-0.5 rounded"
                      title="Reconnecter"
                      style={{ color: theme.textFaint }}
                    >
                      <RefreshCw size={11} />
                    </button>
                    <button
                      onClick={() => handleToggle(server.id, server.disabled)}
                      className="p-0.5 rounded"
                      title={server.disabled ? 'Activer' : 'Désactiver'}
                    >
                      <Power size={11} style={{ color: server.disabled ? theme.textGhost : theme.success }} />
                    </button>
                    <button
                      onClick={() => handleDelete(server.id)}
                      className="p-0.5 rounded"
                      title="Supprimer"
                      style={{ color: theme.error }}
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>

                {/* Error message */}
                {server.error && !expandedServers.has(server.id) && (
                  <div className="px-8 pb-1" style={{ fontSize: 10, color: theme.error }}>
                    {server.error}
                  </div>
                )}

                {/* Expanded tools list */}
                <AnimatePresence>
                  {expandedServers.has(server.id) && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="pl-8 pr-3 pb-2.5 space-y-1">
                        {server.error && (
                          <p style={{ fontSize: 10, color: theme.error }}>{server.error}</p>
                        )}

                        {server.tools.length === 0 ? (
                          <p style={{ fontSize: 10, color: theme.textGhost, fontStyle: 'italic' }}>
                            {server.status === 'ready' ? 'aucun outil exposé' : 'non connecté'}
                          </p>
                        ) : (
                          server.tools
                            .filter(tool => !toolSearch || tool.name.toLowerCase().includes(toolSearch.toLowerCase()) || tool.description?.toLowerCase().includes(toolSearch.toLowerCase()))
                            .map(tool => (
                            <div
                              key={tool.name}
                              className="flex items-start gap-2 px-2 py-1 rounded"
                              style={{ backgroundColor: theme.input, borderRadius: 2 }}
                            >
                              <Wrench size={10} style={{ color: theme.accent, marginTop: 2, flexShrink: 0 }} />
                              <div className="min-w-0">
                                <p className="truncate" style={{ fontSize: 11, color: theme.accent, fontWeight: 500 }}>
                                  {tool.name}
                                </p>
                                {tool.description && (
                                  <p className="line-clamp-2" style={{ fontSize: 10, color: theme.textFaint, marginTop: 1 }}>
                                    {tool.description}
                                  </p>
                                )}
                              </div>
                            </div>
                          ))
                        )}

                        <div className="flex items-center gap-2 pt-1" style={{ fontSize: 10, color: theme.textGhost }}>
                          <span>{server.tools.length} outil{server.tools.length !== 1 ? 's' : ''}</span>
                          <span>·</span>
                          <span>{server.id}</span>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ))}
          </div>
        )}
        </>
       )}

       {/* ── Metrics Tab ── */}
       {activeTab === 'metrics' && (
        <div className="p-3 space-y-3">
          {/* Summary cards */}
          {Object.keys(metricsSummary).length > 0 ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(metricsSummary).map(([serverId, stats]) => (
                  <div
                    key={serverId}
                    className="p-2.5 rounded"
                    style={{ backgroundColor: theme.card, border: `1px solid ${theme.border}`, borderRadius: 3 }}
                  >
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <Zap size={10} style={{ color: theme.accent }} />
                      <span style={{ fontSize: 10, fontWeight: 600, color: theme.textDim }} className="truncate">
                        {serverId}
                      </span>
                    </div>
                    <div className="flex items-center gap-3" style={{ fontSize: 10 }}>
                      <span style={{ color: theme.textHi }}>
                        <TrendingUp size={9} style={{ display: 'inline', marginRight: 2 }} />
                        {stats.calls}
                      </span>
                      {stats.errors > 0 && (
                        <span style={{ color: theme.error }}>
                          ✗ {stats.errors}
                        </span>
                      )}
                      <span style={{ color: theme.textFaint }}>
                        <Clock size={9} style={{ display: 'inline', marginRight: 2 }} />
                        {stats.avgMs}ms
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Recent calls */}
              <div style={{ fontSize: 10, color: theme.textFaint, fontWeight: 600, letterSpacing: 0.5 }}>
                APPELS RÉCENTS
              </div>
              <div
                className="rounded overflow-hidden"
                style={{ backgroundColor: theme.card, border: `1px solid ${theme.border}`, borderRadius: 3 }}
              >
                {metrics.slice(-20).reverse().map((m, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-2 px-3 py-1.5"
                    style={{
                      fontSize: 10,
                      borderTop: idx > 0 ? `1px solid ${theme.border}` : undefined,
                    }}
                  >
                    <span style={{ color: m.success ? theme.success : theme.error, width: 12 }}>
                      {m.success ? '✓' : '✗'}
                    </span>
                    <span className="truncate flex-1" style={{ color: theme.accent, fontWeight: 500 }}>
                      {m.toolName}
                    </span>
                    <span style={{ color: theme.textGhost }}>{m.serverId}</span>
                    <span style={{
                      color: m.durationMs > 5000 ? theme.warning : theme.textFaint,
                      minWidth: 42,
                      textAlign: 'right',
                    }}>
                      {m.durationMs}ms
                    </span>
                    <span style={{ color: theme.textGhost, minWidth: 42, textAlign: 'right' }}>
                      {formatTimestamp(m.timestamp)}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="p-6 text-center" style={{ color: theme.textFaint, fontSize: 11 }}>
              <Activity size={28} className="mx-auto mb-3 opacity-30" />
              <p>aucune métrique disponible</p>
              <p style={{ color: theme.textGhost, marginTop: 4 }}>
                les appels d'outils MCP seront tracés ici
              </p>
            </div>
          )}
        </div>
       )}
      </div>

      {/* ── Footer ── */}
      <div
        className="px-4 py-2 shrink-0 flex items-center justify-between"
        style={{ borderTop: `1px solid ${theme.border}`, fontSize: 10, color: theme.textGhost, letterSpacing: 0.3 }}
      >
        <span>outils MCP exposés automatiquement à l'IA</span>
        {servers.some(s => s.status === 'connecting') && (
          <span className="flex items-center gap-1" style={{ color: theme.warning }}>
            <Loader2 size={9} className="animate-spin" />
            reconnexion...
          </span>
        )}
      </div>
    </div>
  );
}

// ── Helper ────────────────────────────────────────────────────────────────────

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
}
