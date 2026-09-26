import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  Github, GitPullRequest, AlertCircle, Bell, Search, Star,
  ExternalLink, RefreshCw, Loader2, X, BookOpen, GitCommit,
  FolderOpen, Lock, GitMerge, CheckCircle2, Circle, Clock,
  ChevronDown, Filter, MessageSquare, Tag, User, Calendar,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Tooltip } from '../ui/Tooltip.js';
import { WorkspacePublishPanel } from '../github/WorkspacePublishPanel.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Repo {
  full_name: string;
  description: string | null;
  language: string | null;
  stars: number;
  updated_at: string;
  private: boolean;
  html_url: string;
}

interface Issue {
  number: number;
  title: string;
  state: string;
  author: string;
  labels: string[];
  created_at: string;
  comments: number;
  html_url: string;
}

interface PullRequest {
  number: number;
  title: string;
  state: string;
  author: string;
  head: string;
  base: string;
  created_at: string;
  draft: boolean;
  html_url: string;
}

interface Notification {
  id: string;
  reason: string;
  unread: boolean;
  title: string;
  type: string;
  repo: string;
  updated_at: string;
}

interface Commit {
  hash: string;
  shortHash: string;
  author: string;
  email: string;
  date: string;
  message: string;
}

interface CommitDetail {
  hash: string;
  author: string;
  email: string;
  date: string;
  message: string;
  files: CommitFile[];
}

interface CommitFile {
  status: string;
  path: string;
}

type Tab = 'commits' | 'repos' | 'issues' | 'prs' | 'notifications';
type IssueFilter = 'open' | 'closed' | 'all';
type PRFilter = 'open' | 'closed' | 'all';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}j`;
  return `${Math.floor(days / 30)}mo`;
}

function langColor(lang: string | null): string {
  const map: Record<string, string> = {
    TypeScript: '#3178c6', JavaScript: '#f1e05a', Python: '#3572A5',
    Rust: '#dea584', Go: '#00ADD8', Java: '#b07219', 'C#': '#178600',
    HTML: '#e34c26', CSS: '#563d7c', Shell: '#89e051', Ruby: '#701516',
    Swift: '#F05138', Kotlin: '#A97BFF', Dart: '#00B4AB', Vue: '#41b883',
  };
  return map[lang || ''] || 'var(--text-dimmed)';
}

function openExternal(url: string) {
  const api = (window as any).electronAPI;
  if (api?.openExternal) api.openExternal(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
}

const FILE_STATUS: Record<string, { bg: string; color: string }> = {
  A: { bg: 'rgba(63,185,80,0.15)',   color: '#3fb950' },
  M: { bg: 'rgba(14,165,233,0.15)',  color: 'var(--accent-primary)' },
  D: { bg: 'rgba(248,81,73,0.15)',   color: '#f85149' },
  R: { bg: 'rgba(163,113,247,0.15)', color: '#a371f7' },
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function EmptyState({ icon: Icon, title, subtitle }: {
  icon: React.ElementType; title: string; subtitle?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center h-full py-16 px-6 text-center gap-3">
      <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
        style={{ backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-base)' }}>
        <Icon size={22} style={{ color: 'var(--text-dimmed)' }} />
      </div>
      <div>
        <p className="text-sm font-semibold" style={{ color: 'var(--text-muted)' }}>{title}</p>
        {subtitle && <p className="text-xs mt-1 max-w-xs mx-auto" style={{ color: 'var(--text-dimmed)' }}>{subtitle}</p>}
      </div>
    </div>
  );
}

function FilterDropdown({ value, options, onChange }: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const current = options.find(o => o.value === value);
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium hover:bg-white/8"
        style={{ border: '1px solid var(--border-base)', color: 'var(--text-muted)' }}
      >
        <Filter size={10} />
        {current?.label}
        <ChevronDown size={10} style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s' }} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.1 }}
            className="absolute right-0 mt-1 z-50 rounded-lg overflow-hidden"
            style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-base)', boxShadow: 'var(--shadow-lg)', minWidth: 110 }}
          >
            {options.map(opt => (
              <button key={opt.value} onClick={() => { onChange(opt.value); setOpen(false); }}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-white/8"
                style={{ color: opt.value === value ? 'var(--accent-primary)' : 'var(--text-primary)' }}>
                {opt.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Commit detail right panel ────────────────────────────────────────────────

function CommitDetailPanel({ commit, loading, repoUrl, onClose }: {
  commit: CommitDetail | null;
  loading: boolean;
  repoUrl: string;
  onClose: () => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full gap-2">
        <Loader2 size={16} className="animate-spin" style={{ color: 'var(--accent-primary)' }} />
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Chargement…</span>
      </div>
    );
  }
  if (!commit) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-8">
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
          style={{ backgroundColor: 'rgba(14,165,233,0.08)', border: '1px solid rgba(14,165,233,0.15)' }}>
          <GitCommit size={20} style={{ color: 'var(--accent-primary)', opacity: 0.4 }} />
        </div>
        <p className="text-xs" style={{ color: 'var(--text-dimmed)' }}>
          Sélectionnez un commit pour voir les fichiers modifiés
        </p>
      </div>
    );
  }

  const added    = commit.files.filter(f => f.status === 'A').length;
  const modified = commit.files.filter(f => f.status === 'M').length;
  const deleted  = commit.files.filter(f => f.status === 'D').length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-5 py-4 border-b flex-shrink-0" style={{ borderColor: 'var(--border-base)' }}>
        <div className="flex items-start justify-between gap-3 mb-3">
          <p className="text-sm font-semibold leading-snug flex-1" style={{ color: 'var(--text-primary)' }}>
            {commit.message}
          </p>
          <div className="flex gap-1 flex-shrink-0">
            {repoUrl && (
              <Tooltip content="Voir sur GitHub" as="button"
                onClick={() => openExternal(`${repoUrl}/commit/${commit.hash}`)}
                className="p-1.5 rounded-md hover:bg-white/8">
                <ExternalLink size={13} style={{ color: 'var(--accent-primary)' }} />
              </Tooltip>
            )}
            <Tooltip content="Fermer" as="button" onClick={onClose} className="p-1.5 rounded-md hover:bg-white/8">
              <X size={13} style={{ color: 'var(--text-dimmed)' }} />
            </Tooltip>
          </div>
        </div>

        {/* Meta */}
        <div className="flex flex-wrap gap-3 mb-3">
          <span className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-1 rounded-md"
            style={{ backgroundColor: 'rgba(14,165,233,0.1)', color: 'var(--accent-primary)', border: '1px solid rgba(14,165,233,0.2)' }}>
            {commit.hash.slice(0, 10)}
          </span>
          <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
            <User size={11} /> {commit.author}
          </span>
          <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: 'var(--text-dimmed)' }}>
            <Calendar size={11} />
            {new Date(commit.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}
          </span>
        </div>

        {/* Stats */}
        <div className="flex gap-2 flex-wrap">
          {added > 0 && (
            <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full"
              style={{ backgroundColor: 'rgba(63,185,80,0.12)', color: '#3fb950', border: '1px solid rgba(63,185,80,0.2)' }}>
              +{added} ajouté{added > 1 ? 's' : ''}
            </span>
          )}
          {modified > 0 && (
            <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full"
              style={{ backgroundColor: 'rgba(14,165,233,0.12)', color: 'var(--accent-primary)', border: '1px solid rgba(14,165,233,0.2)' }}>
              ~{modified} modifié{modified > 1 ? 's' : ''}
            </span>
          )}
          {deleted > 0 && (
            <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full"
              style={{ backgroundColor: 'rgba(248,81,73,0.12)', color: '#f85149', border: '1px solid rgba(248,81,73,0.2)' }}>
              -{deleted} supprimé{deleted > 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      {/* Files list */}
      <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-3">
        <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-dimmed)' }}>
          {commit.files.length} fichier{commit.files.length !== 1 ? 's' : ''}
        </p>
        <div className="grid gap-0.5">
          {commit.files.map((file, i) => {
            const cfg = FILE_STATUS[file.status] ?? FILE_STATUS['M'];
            return (
              <div key={i} className="flex items-center gap-2.5 px-3 py-2 rounded-lg"
                style={{ backgroundColor: 'rgba(255,255,255,0.025)' }}>
                <span className="w-4 h-4 rounded flex items-center justify-center text-[9px] font-bold flex-shrink-0"
                  style={{ backgroundColor: cfg.bg, color: cfg.color }}>
                  {file.status}
                </span>
                <span className="text-[11px] font-mono truncate" style={{ color: 'var(--text-primary)' }}>
                  {file.path}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface GitHubPanelProps {
  onClose: () => void;
  /** When true, occupies the full editor area in 2-column layout */
  fullWidth?: boolean;
}

export function GitHubPanel({ onClose, fullWidth = false }: GitHubPanelProps) {
  const [tab, setTab] = useState<Tab>('commits');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configured, setConfigured] = useState(true);

  const [repoOwner, setRepoOwner] = useState('');
  const [repoName, setRepoName]   = useState('');
  const [repoUrl, setRepoUrl]     = useState('');
  const [detectingRepo, setDetectingRepo] = useState(true);

  const [commits, setCommits]             = useState<Commit[]>([]);
  const [repos, setRepos]                 = useState<Repo[]>([]);
  const [issues, setIssues]               = useState<Issue[]>([]);
  const [prs, setPrs]                     = useState<PullRequest[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);

  // Detail selection
  const [selectedCommit, setSelectedCommit] = useState<CommitDetail | null>(null);
  const [loadingDetail, setLoadingDetail]   = useState(false);
  const [selectedIssue, setSelectedIssue]   = useState<Issue | null>(null);
  const [selectedPR, setSelectedPR]         = useState<PullRequest | null>(null);
  const [selectedRepo, setSelectedRepo]     = useState<Repo | null>(null);

  const [issueFilter, setIssueFilter] = useState<IssueFilter>('open');
  const [prFilter, setPrFilter]       = useState<PRFilter>('open');
  const [repoSearch, setRepoSearch]   = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const unreadCount = notifications.filter(n => n.unread).length;

  // ─── API ──────────────────────────────────────────────────────────────

  const detectCurrentRepo = useCallback(async () => {
    setDetectingRepo(true);
    try {
      const res  = await fetch('/api/github/current-repo');
      const data = await res.json();
      if (data.status === 'success' && data.owner && data.repo) {
        setRepoOwner(data.owner);
        setRepoName(data.repo);
        setRepoUrl(`https://github.com/${data.owner}/${data.repo}`);
      }
    } catch { /* ignore */ }
    finally { setDetectingRepo(false); }
  }, []);

  const fetchCommits = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res  = await fetch('/api/github/commits?limit=50');
      const data = await res.json();
      if (data.error) { setError(data.error); return; }
      setCommits(data.commits || []);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  const fetchRepos = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res  = await fetch('/api/github/repos');
      const data = await res.json();
      if (data.error) {
        if (data.error.includes('TOKEN')) setConfigured(false);
        setError(data.error);
        return;
      }
      setRepos(data.repos || []);
      setConfigured(true);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  const fetchIssues = useCallback(async (state = issueFilter) => {
    if (!repoOwner || !repoName) return;
    setLoading(true); setError(null);
    try {
      const p    = new URLSearchParams({ owner: repoOwner, repo: repoName, state: state === 'all' ? 'all' : state });
      const res  = await fetch(`/api/github/issues?${p}`);
      const data = await res.json();
      if (data.error) { setError(data.error); return; }
      setIssues(data.issues || []);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [repoOwner, repoName, issueFilter]);

  const fetchPRs = useCallback(async (state = prFilter) => {
    if (!repoOwner || !repoName) return;
    setLoading(true); setError(null);
    try {
      const p    = new URLSearchParams({ owner: repoOwner, repo: repoName, state: state === 'all' ? 'all' : state });
      const res  = await fetch(`/api/github/pulls?${p}`);
      const data = await res.json();
      if (data.error) { setError(data.error); return; }
      setPrs(data.pull_requests || []);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [repoOwner, repoName, prFilter]);

  const fetchNotifications = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res  = await fetch('/api/github/notifications');
      const data = await res.json();
      if (data.error) { setError(`⚠️ ${data.error}`); setNotifications([]); return; }
      setNotifications(data.notifications || []);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  const fetchCommitDetail = useCallback(async (hash: string) => {
    setLoadingDetail(true);
    try {
      const res  = await fetch(`/api/github/commits/${hash}`);
      const data = await res.json();
      if (data.error) { setError(data.error); return; }
      setSelectedCommit(data);
    } catch (e: any) { setError(e.message); }
    finally { setLoadingDetail(false); }
  }, []);

  const searchRepos = useCallback(async () => {
    if (!searchQuery.trim()) return;
    setLoading(true); setError(null);
    try {
      const res  = await fetch(`/api/github/search?query=${encodeURIComponent(searchQuery.trim())}`);
      const data = await res.json();
      if (data.error) { setError(data.error); return; }
      setRepos(data.repos || []);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [searchQuery]);

  const refresh = useCallback(() => {
    setError(null);
    if (tab === 'commits')       fetchCommits();
    else if (tab === 'repos')    fetchRepos();
    else if (tab === 'issues')   fetchIssues();
    else if (tab === 'prs')      fetchPRs();
    else                         fetchNotifications();
  }, [tab, fetchCommits, fetchRepos, fetchIssues, fetchPRs, fetchNotifications]);

  // ─── Effects ──────────────────────────────────────────────────────────

  useEffect(() => { detectCurrentRepo(); }, [detectCurrentRepo]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchCommits(); }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (tab === 'repos' && repos.length === 0) fetchRepos();
    if (tab === 'notifications') fetchNotifications();
  }, [tab]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (tab === 'issues') fetchIssues(issueFilter); }, [issueFilter]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (tab === 'prs') fetchPRs(prFilter); }, [prFilter]);
  useEffect(() => {
    if (repoOwner && repoName) {
      if (tab === 'issues') fetchIssues();
      else if (tab === 'prs') fetchPRs();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoOwner, repoName]);

  const filteredRepos = repoSearch.trim()
    ? repos.filter(r => r.full_name.toLowerCase().includes(repoSearch.toLowerCase()))
    : repos;

  // ─── Tab config ───────────────────────────────────────────────────────

  const tabs: { key: Tab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { key: 'commits',       label: 'Commits',       icon: <GitCommit size={12} />,      badge: commits.length || undefined },
    { key: 'repos',         label: 'Repos',         icon: <BookOpen size={12} /> },
    { key: 'issues',        label: 'Issues',        icon: <AlertCircle size={12} />,    badge: issues.filter(i => i.state === 'open').length || undefined },
    { key: 'prs',           label: 'Pull Requests', icon: <GitPullRequest size={12} />, badge: prs.filter(p => p.state === 'open').length || undefined },
    { key: 'notifications', label: 'Notifications', icon: <Bell size={12} />,           badge: unreadCount || undefined },
  ];

  // ─── Shared header + tabs shell ───────────────────────────────────────

  const shell = (children: React.ReactNode) => (
    <div
      className={`flex flex-col h-full ${fullWidth ? 'flex-1 min-w-0' : 'border-l'}`}
      style={fullWidth
        ? { backgroundColor: 'var(--bg-panel)' }
        : { width: 340, borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-panel)' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b flex-shrink-0"
        style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-base)' }}>
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: 'var(--accent-subtle)' }}>
            <Github size={15} style={{ color: 'var(--accent-primary)' }} />
          </div>
          <div className="min-w-0 flex items-center gap-2">
            <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>GitHub</span>
            {!detectingRepo && repoOwner && repoName ? (
              <button onClick={() => openExternal(repoUrl)}
                className="inline-flex items-center gap-1 text-xs font-mono px-1.5 py-0.5 rounded hover:opacity-75 transition-opacity"
                style={{ backgroundColor: 'rgba(14,165,233,0.1)', color: 'var(--accent-primary)', border: '1px solid rgba(14,165,233,0.2)' }}>
                {repoOwner}/{repoName} <ExternalLink size={9} />
              </button>
            ) : detectingRepo ? (
              <span className="text-xs" style={{ color: 'var(--text-dimmed)' }}>détection…</span>
            ) : (
              <span className="text-xs" style={{ color: 'var(--text-dimmed)' }}>aucun repo</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Tooltip content="Rafraîchir" as="button" onClick={refresh} className="p-1.5 rounded-md hover:bg-white/8">
            {loading
              ? <Loader2 size={14} className="animate-spin" style={{ color: 'var(--accent-primary)' }} />
              : <RefreshCw size={14} style={{ color: 'var(--text-muted)' }} />}
          </Tooltip>
          <Tooltip content="Fermer" as="button" onClick={onClose} className="p-1.5 rounded-md hover:bg-white/8">
            <X size={14} style={{ color: 'var(--text-muted)' }} />
          </Tooltip>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b flex-shrink-0 overflow-x-auto" style={{ borderColor: 'var(--border-base)' }}>
        {tabs.map(({ key, label, icon, badge }) => (
          <button key={key} onClick={() => setTab(key)}
            className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-all"
            style={{
              borderColor:     tab === key ? 'var(--accent-primary)' : 'transparent',
              color:           tab === key ? 'var(--accent-primary)' : 'var(--text-dimmed)',
              backgroundColor: tab === key ? 'rgba(14,165,233,0.04)' : 'transparent',
            }}>
            {icon} {label}
            {badge !== undefined && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-none"
                style={{
                  backgroundColor: key === 'notifications' ? 'rgba(239,68,68,0.15)' : 'rgba(14,165,233,0.15)',
                  color:           key === 'notifications' ? '#f87171'              : 'var(--accent-primary)',
                }}>
                {badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Error banner */}
      <AnimatePresence>
        {error && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }} className="mx-4 mt-2 flex-shrink-0">
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg text-xs"
              style={{ backgroundColor: 'rgba(239,68,68,0.07)', color: '#f87171', border: '1px solid rgba(239,68,68,0.15)' }}>
              <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />
              <span className="flex-1">{error}</span>
              <button onClick={() => setError(null)} className="opacity-60 hover:opacity-100"><X size={11} /></button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {children}
    </div>
  );

  // ─── Not configured ───────────────────────────────────────────────────

  if (!configured) {
    return shell(
      <EmptyState icon={Github} title="GitHub non configuré"
        subtitle="Ajoutez GITHUB_TOKEN dans vos paramètres pour accéder à vos repos, issues et PRs." />
    );
  }

  // ─── Two-column body (list | detail) ─────────────────────────────────

  const listColStyle: React.CSSProperties = fullWidth
    ? { width: '38%', minWidth: 260, maxWidth: 480, flexShrink: 0, borderRight: '1px solid var(--border-base)' }
    : { flex: 1 };

  return shell(
    <div className="flex flex-1 min-h-0">

      {/* ════ LEFT — list ════════════════════════════════════════════════ */}
      <div className="flex flex-col min-h-0 overflow-hidden" style={listColStyle}>

        <div className="flex-shrink-0 border-b p-3" style={{ borderColor: 'var(--border-base)' }}>
          <WorkspacePublishPanel onPublished={fetchCommits} />
        </div>

        {/* ── COMMITS list ── */}
        {tab === 'commits' && (
          <div className="flex flex-col h-full overflow-hidden">
            <div className="px-3 py-2 border-b flex-shrink-0 flex items-center justify-between"
              style={{ borderColor: 'var(--border-base)' }}>
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-dimmed)' }}>
                {commits.length} commit{commits.length !== 1 ? 's' : ''}
              </span>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar">
              {loading && commits.length === 0 && (
                <div className="flex items-center justify-center py-10 gap-2">
                  <Loader2 size={14} className="animate-spin" style={{ color: 'var(--accent-primary)' }} />
                </div>
              )}
              {!loading && commits.length === 0 && (
                <EmptyState icon={GitCommit} title="Aucun commit" subtitle="Ce workspace n'a pas de dépôt git." />
              )}
              <div className="p-2 grid gap-0.5">
                {commits.map(commit => {
                  const active = selectedCommit?.hash === commit.hash;
                  return (
                    <button key={commit.hash}
                      onClick={() => active ? setSelectedCommit(null) : fetchCommitDetail(commit.hash)}
                      className="w-full text-left flex items-start gap-2.5 rounded-lg px-2.5 py-2 transition-colors hover:bg-white/5"
                      style={{
                        border: '1px solid',
                        borderColor: active ? 'rgba(14,165,233,0.4)' : 'transparent',
                        backgroundColor: active ? 'rgba(14,165,233,0.07)' : undefined,
                      }}>
                      <div className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0 mt-0.5"
                        style={{ backgroundColor: 'rgba(14,165,233,0.1)' }}>
                        <GitCommit size={10} style={{ color: 'var(--accent-primary)' }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium leading-snug" style={{ color: 'var(--text-primary)' }}>
                          {commit.message.length > 64 ? commit.message.slice(0, 64) + '…' : commit.message}
                        </p>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <span className="text-[10px] font-mono px-1 py-0.5 rounded"
                            style={{ backgroundColor: 'rgba(14,165,233,0.08)', color: 'var(--accent-primary)' }}>
                            {commit.shortHash}
                          </span>
                          <span className="text-[10px]" style={{ color: 'var(--text-dimmed)' }}>{commit.author}</span>
                          <span className="text-[10px]" style={{ color: 'var(--text-dimmed)' }}>{timeAgo(commit.date)}</span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ── REPOS list ── */}
        {tab === 'repos' && (
          <div className="flex flex-col h-full overflow-hidden">
            <div className="px-3 py-2 border-b flex-shrink-0 flex gap-2"
              style={{ borderColor: 'var(--border-base)' }}>
              <div className="relative flex-1">
                <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                  style={{ color: 'var(--text-dimmed)' }} />
                <input value={repoSearch} onChange={e => setRepoSearch(e.target.value)}
                  placeholder="Filtrer…"
                  className="w-full pl-7 pr-2 py-1.5 rounded-md text-xs focus:outline-none"
                  style={{ backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-base)', color: 'var(--text-primary)' }} />
              </div>
              <div className="relative">
                <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                  style={{ color: 'var(--text-dimmed)' }} />
                <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && searchRepos()}
                  placeholder="GitHub…" title="Entrée pour chercher"
                  className="w-full pl-7 pr-2 py-1.5 rounded-md text-xs focus:outline-none"
                  style={{ backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-base)', color: 'var(--text-primary)' }} />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar">
              {loading && repos.length === 0 && (
                <div className="flex items-center justify-center py-10">
                  <Loader2 size={14} className="animate-spin" style={{ color: 'var(--accent-primary)' }} />
                </div>
              )}
              {!loading && filteredRepos.length === 0 && (
                <EmptyState icon={BookOpen} title="Aucun repo"
                  subtitle={repos.length > 0 ? 'Aucun résultat.' : 'Configurez votre GITHUB_TOKEN.'} />
              )}
              <div className="p-2 grid gap-0.5">
                {filteredRepos.map(repo => {
                  const active = selectedRepo?.full_name === repo.full_name;
                  return (
                    <div key={repo.full_name}
                      onClick={() => {
                        setSelectedRepo(active ? null : repo);
                        const [o, n] = repo.full_name.split('/');
                        setRepoOwner(o); setRepoName(n); setRepoUrl(repo.html_url);
                      }}
                      role="button" tabIndex={0}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          setSelectedRepo(active ? null : repo);
                          const [o, n] = repo.full_name.split('/');
                          setRepoOwner(o); setRepoName(n); setRepoUrl(repo.html_url);
                        }
                      }}
                      className="flex items-start gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer hover:bg-white/5 transition-colors"
                      style={{
                        border: '1px solid',
                        borderColor: active ? 'rgba(14,165,233,0.4)' : 'transparent',
                        backgroundColor: active ? 'rgba(14,165,233,0.07)' : undefined,
                      }}>
                      {repo.private
                        ? <Lock size={12} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--text-dimmed)' }} />
                        : <FolderOpen size={12} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--accent-primary)' }} />
                      }
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>{repo.full_name}</p>
                        {repo.description && (
                          <p className="text-[10px] truncate mt-0.5" style={{ color: 'var(--text-dimmed)' }}>{repo.description}</p>
                        )}
                        <div className="flex items-center gap-2 mt-1">
                          {repo.language && (
                            <span className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--text-dimmed)' }}>
                              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: langColor(repo.language) }} />
                              {repo.language}
                            </span>
                          )}
                          <span className="flex items-center gap-0.5 text-[10px]" style={{ color: 'var(--text-dimmed)' }}>
                            <Star size={9} /> {repo.stars}
                          </span>
                          <span className="text-[10px]" style={{ color: 'var(--text-dimmed)' }}>{timeAgo(repo.updated_at)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ── ISSUES list ── */}
        {tab === 'issues' && (
          <div className="flex flex-col h-full overflow-hidden">
            <div className="px-3 py-2 border-b flex items-center justify-between flex-shrink-0"
              style={{ borderColor: 'var(--border-base)' }}>
              <span className="text-[10px] font-bold uppercase tracking-wider truncate" style={{ color: 'var(--text-dimmed)' }}>
                {repoOwner && repoName ? `${repoOwner}/${repoName}` : 'Aucun repo'}
              </span>
              <FilterDropdown value={issueFilter}
                options={[{ value: 'open', label: 'Ouvertes' }, { value: 'closed', label: 'Fermées' }, { value: 'all', label: 'Toutes' }]}
                onChange={v => setIssueFilter(v as IssueFilter)} />
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar">
              {!repoOwner ? (
                <EmptyState icon={AlertCircle} title="Sélectionnez un repo" subtitle="Allez dans l'onglet Repos." />
              ) : loading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 size={14} className="animate-spin" style={{ color: 'var(--accent-primary)' }} />
                </div>
              ) : issues.length === 0 ? (
                <EmptyState icon={CheckCircle2} title="Aucune issue" />
              ) : (
                <div className="p-2 grid gap-0.5">
                  {issues.map(issue => {
                    const active = selectedIssue?.number === issue.number;
                    return (
                      <button key={issue.number}
                        onClick={() => setSelectedIssue(active ? null : issue)}
                        className="w-full text-left flex items-start gap-2.5 px-2.5 py-2 rounded-lg hover:bg-white/5 transition-colors"
                        style={{
                          border: '1px solid',
                          borderColor: active ? 'rgba(14,165,233,0.4)' : 'transparent',
                          backgroundColor: active ? 'rgba(14,165,233,0.07)' : undefined,
                        }}>
                        {issue.state === 'open'
                          ? <Circle size={12} className="mt-0.5 flex-shrink-0" style={{ color: '#3fb950' }} />
                          : <CheckCircle2 size={12} className="mt-0.5 flex-shrink-0" style={{ color: '#a371f7' }} />}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium leading-snug" style={{ color: 'var(--text-primary)' }}>
                            <span style={{ color: 'var(--text-dimmed)' }}>#{issue.number}</span> {issue.title}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[10px]" style={{ color: 'var(--text-dimmed)' }}>{issue.author}</span>
                            <span className="text-[10px]" style={{ color: 'var(--text-dimmed)' }}>{timeAgo(issue.created_at)}</span>
                            {issue.comments > 0 && (
                              <span className="flex items-center gap-0.5 text-[10px]" style={{ color: 'var(--text-dimmed)' }}>
                                <MessageSquare size={9} /> {issue.comments}
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── PULL REQUESTS list ── */}
        {tab === 'prs' && (
          <div className="flex flex-col h-full overflow-hidden">
            <div className="px-3 py-2 border-b flex items-center justify-between flex-shrink-0"
              style={{ borderColor: 'var(--border-base)' }}>
              <span className="text-[10px] font-bold uppercase tracking-wider truncate" style={{ color: 'var(--text-dimmed)' }}>
                {repoOwner && repoName ? `${repoOwner}/${repoName}` : 'Aucun repo'}
              </span>
              <FilterDropdown value={prFilter}
                options={[{ value: 'open', label: 'Ouvertes' }, { value: 'closed', label: 'Fermées' }, { value: 'all', label: 'Toutes' }]}
                onChange={v => setPrFilter(v as PRFilter)} />
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar">
              {!repoOwner ? (
                <EmptyState icon={GitPullRequest} title="Sélectionnez un repo" subtitle="Allez dans l'onglet Repos." />
              ) : loading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 size={14} className="animate-spin" style={{ color: 'var(--accent-primary)' }} />
                </div>
              ) : prs.length === 0 ? (
                <EmptyState icon={GitMerge} title="Aucune PR" />
              ) : (
                <div className="p-2 grid gap-0.5">
                  {prs.map(pr => {
                    const active = selectedPR?.number === pr.number;
                    return (
                      <button key={pr.number}
                        onClick={() => setSelectedPR(active ? null : pr)}
                        className="w-full text-left flex items-start gap-2.5 px-2.5 py-2 rounded-lg hover:bg-white/5 transition-colors"
                        style={{
                          border: '1px solid',
                          borderColor: active ? 'rgba(14,165,233,0.4)' : 'transparent',
                          backgroundColor: active ? 'rgba(14,165,233,0.07)' : undefined,
                        }}>
                        {pr.state === 'open'
                          ? <GitPullRequest size={12} className="mt-0.5 flex-shrink-0" style={{ color: '#3fb950' }} />
                          : <GitMerge size={12} className="mt-0.5 flex-shrink-0" style={{ color: '#a371f7' }} />}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="text-xs font-medium leading-snug flex-1" style={{ color: 'var(--text-primary)' }}>
                              <span style={{ color: 'var(--text-dimmed)' }}>#{pr.number}</span> {pr.title}
                            </p>
                            {pr.draft && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded-full flex-shrink-0"
                                style={{ backgroundColor: 'rgba(255,255,255,0.06)', color: 'var(--text-dimmed)' }}>draft</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[10px]" style={{ color: 'var(--text-dimmed)' }}>{pr.author}</span>
                            <span className="text-[10px] font-mono" style={{ color: 'var(--text-dimmed)' }}>
                              {pr.head.length > 14 ? pr.head.slice(0, 14) + '…' : pr.head} → {pr.base}
                            </span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── NOTIFICATIONS list ── */}
        {tab === 'notifications' && (
          <div className="flex flex-col h-full overflow-hidden">
            <div className="px-3 py-2 border-b flex-shrink-0" style={{ borderColor: 'var(--border-base)' }}>
              {unreadCount > 0
                ? <span className="text-[11px] font-semibold" style={{ color: '#f87171' }}>{unreadCount} non lue{unreadCount > 1 ? 's' : ''}</span>
                : <span className="text-[11px]" style={{ color: 'var(--text-dimmed)' }}>Notifications</span>}
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar">
              {loading && notifications.length === 0 && (
                <div className="flex items-center justify-center py-10">
                  <Loader2 size={14} className="animate-spin" style={{ color: 'var(--accent-primary)' }} />
                </div>
              )}
              {!loading && notifications.length === 0 && (
                <EmptyState icon={Bell} title="Aucune notification" subtitle="Vous êtes à jour !" />
              )}
              <div className="p-2 grid gap-0.5">
                {notifications.map(n => (
                  <div key={n.id}
                    className="flex items-start gap-2.5 px-2.5 py-2 rounded-lg hover:bg-white/5 transition-colors"
                    style={{ border: '1px solid', borderColor: n.unread ? 'rgba(239,68,68,0.12)' : 'transparent' }}>
                    <Bell size={12} className="mt-0.5 flex-shrink-0"
                      style={{ color: n.unread ? '#f87171' : 'var(--text-dimmed)' }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate"
                        style={{ color: n.unread ? 'var(--text-primary)' : 'var(--text-muted)' }}>{n.title}</p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full"
                          style={{ backgroundColor: 'rgba(255,255,255,0.05)', color: 'var(--text-dimmed)' }}>{n.type}</span>
                        <span className="text-[10px] truncate" style={{ color: 'var(--text-dimmed)' }}>{n.repo}</span>
                        <span className="text-[10px] flex-shrink-0" style={{ color: 'var(--text-dimmed)' }}>{timeAgo(n.updated_at)}</span>
                      </div>
                    </div>
                    {n.unread && <span className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" style={{ backgroundColor: '#f87171' }} />}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ════ RIGHT — detail (fullWidth only) ════════════════════════════ */}
      {fullWidth && (
        <div className="flex-1 min-w-0 overflow-hidden" style={{ backgroundColor: 'var(--bg-base)' }}>

          {/* Commits → diff detail */}
          {tab === 'commits' && (
            <CommitDetailPanel
              commit={selectedCommit}
              loading={loadingDetail}
              repoUrl={repoUrl}
              onClose={() => setSelectedCommit(null)}
            />
          )}

          {/* Repos → quick actions */}
          {tab === 'repos' && (
            selectedRepo ? (
              <div className="flex flex-col h-full">
                <div className="px-6 py-5 border-b flex-shrink-0" style={{ borderColor: 'var(--border-base)' }}>
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        {selectedRepo.private
                          ? <Lock size={14} style={{ color: 'var(--text-dimmed)' }} />
                          : <FolderOpen size={14} style={{ color: 'var(--accent-primary)' }} />}
                        <h2 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>{selectedRepo.full_name}</h2>
                      </div>
                      {selectedRepo.description && (
                        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{selectedRepo.description}</p>
                      )}
                    </div>
                    <button onClick={() => openExternal(selectedRepo.html_url)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold flex-shrink-0 hover:opacity-75 transition-opacity"
                      style={{ backgroundColor: 'var(--accent-subtle)', color: 'var(--accent-primary)', border: '1px solid rgba(14,165,233,0.2)' }}>
                      <ExternalLink size={12} /> Ouvrir sur GitHub
                    </button>
                  </div>
                  <div className="flex items-center gap-4">
                    {selectedRepo.language && (
                      <span className="flex items-center gap-1.5 text-sm" style={{ color: 'var(--text-muted)' }}>
                        <span className="w-3 h-3 rounded-full" style={{ backgroundColor: langColor(selectedRepo.language) }} />
                        {selectedRepo.language}
                      </span>
                    )}
                    <span className="flex items-center gap-1 text-sm" style={{ color: 'var(--text-muted)' }}>
                      <Star size={13} /> {selectedRepo.stars}
                    </span>
                    <span className="text-xs" style={{ color: 'var(--text-dimmed)' }}>
                      Mis à jour {timeAgo(selectedRepo.updated_at)}
                    </span>
                  </div>
                </div>
                <div className="flex-1 flex items-center justify-center gap-4 px-6">
                  <button onClick={() => { setTab('issues'); fetchIssues(); }}
                    className="flex flex-col items-center gap-3 p-8 rounded-2xl hover:bg-white/5 transition-colors"
                    style={{ border: '1px solid var(--border-base)', minWidth: 160 }}>
                    <AlertCircle size={28} style={{ color: '#3fb950' }} />
                    <div className="text-center">
                      <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Issues</p>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--text-dimmed)' }}>Voir les issues ouvertes</p>
                    </div>
                  </button>
                  <button onClick={() => { setTab('prs'); fetchPRs(); }}
                    className="flex flex-col items-center gap-3 p-8 rounded-2xl hover:bg-white/5 transition-colors"
                    style={{ border: '1px solid var(--border-base)', minWidth: 160 }}>
                    <GitPullRequest size={28} style={{ color: 'var(--accent-primary)' }} />
                    <div className="text-center">
                      <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Pull Requests</p>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--text-dimmed)' }}>Voir les PRs ouvertes</p>
                    </div>
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-8">
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
                  style={{ backgroundColor: 'rgba(14,165,233,0.08)', border: '1px solid rgba(14,165,233,0.15)' }}>
                  <BookOpen size={20} style={{ color: 'var(--accent-primary)', opacity: 0.4 }} />
                </div>
                <p className="text-xs" style={{ color: 'var(--text-dimmed)' }}>Sélectionnez un repo pour voir ses détails</p>
              </div>
            )
          )}

          {/* Issues → detail */}
          {tab === 'issues' && (
            selectedIssue ? (
              <div className="flex flex-col h-full">
                <div className="px-6 py-5 border-b flex-shrink-0" style={{ borderColor: 'var(--border-base)' }}>
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      {selectedIssue.state === 'open'
                        ? <Circle size={18} className="mt-0.5 flex-shrink-0" style={{ color: '#3fb950' }} />
                        : <CheckCircle2 size={18} className="mt-0.5 flex-shrink-0" style={{ color: '#a371f7' }} />}
                      <h2 className="text-base font-bold leading-snug" style={{ color: 'var(--text-primary)' }}>
                        <span className="font-normal" style={{ color: 'var(--text-dimmed)' }}>#{selectedIssue.number}</span>{' '}
                        {selectedIssue.title}
                      </h2>
                    </div>
                    <button onClick={() => openExternal(selectedIssue.html_url)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold flex-shrink-0 hover:opacity-75 transition-opacity"
                      style={{ backgroundColor: 'var(--accent-subtle)', color: 'var(--accent-primary)', border: '1px solid rgba(14,165,233,0.2)' }}>
                      <ExternalLink size={12} /> Ouvrir
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-4">
                    <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                      <User size={13} /> {selectedIssue.author}
                    </span>
                    <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                      <Clock size={13} /> {timeAgo(selectedIssue.created_at)}
                    </span>
                    {selectedIssue.comments > 0 && (
                      <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                        <MessageSquare size={13} /> {selectedIssue.comments} commentaire{selectedIssue.comments > 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  {selectedIssue.labels.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {selectedIssue.labels.map(l => (
                        <span key={l} className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full"
                          style={{ backgroundColor: 'rgba(255,255,255,0.06)', color: 'var(--text-muted)', border: '1px solid var(--border-base)' }}>
                          <Tag size={10} /> {l}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex-1 flex items-center justify-center px-8">
                  <p className="text-xs text-center" style={{ color: 'var(--text-dimmed)' }}>
                    Ouvrez sur GitHub pour voir les commentaires et l'historique complet
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full gap-3 px-8">
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
                  style={{ backgroundColor: 'rgba(63,185,80,0.08)', border: '1px solid rgba(63,185,80,0.15)' }}>
                  <AlertCircle size={20} style={{ color: '#3fb950', opacity: 0.4 }} />
                </div>
                <p className="text-xs" style={{ color: 'var(--text-dimmed)' }}>Cliquez sur une issue pour voir ses détails</p>
              </div>
            )
          )}

          {/* PRs → detail */}
          {tab === 'prs' && (
            selectedPR ? (
              <div className="flex flex-col h-full">
                <div className="px-6 py-5 border-b flex-shrink-0" style={{ borderColor: 'var(--border-base)' }}>
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      {selectedPR.state === 'open'
                        ? <GitPullRequest size={18} className="mt-0.5 flex-shrink-0" style={{ color: '#3fb950' }} />
                        : <GitMerge size={18} className="mt-0.5 flex-shrink-0" style={{ color: '#a371f7' }} />}
                      <div className="min-w-0">
                        <h2 className="text-base font-bold leading-snug" style={{ color: 'var(--text-primary)' }}>
                          <span className="font-normal" style={{ color: 'var(--text-dimmed)' }}>#{selectedPR.number}</span>{' '}
                          {selectedPR.title}
                        </h2>
                        {selectedPR.draft && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold mt-1 inline-block"
                            style={{ backgroundColor: 'rgba(255,255,255,0.06)', color: 'var(--text-dimmed)' }}>Draft</span>
                        )}
                      </div>
                    </div>
                    <button onClick={() => openExternal(selectedPR.html_url)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold flex-shrink-0 hover:opacity-75 transition-opacity"
                      style={{ backgroundColor: 'var(--accent-subtle)', color: 'var(--accent-primary)', border: '1px solid rgba(14,165,233,0.2)' }}>
                      <ExternalLink size={12} /> Ouvrir
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-4">
                    <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                      <User size={13} /> {selectedPR.author}
                    </span>
                    <span className="flex items-center gap-1.5 text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                      {selectedPR.head} → {selectedPR.base}
                    </span>
                    <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                      <Clock size={13} /> {timeAgo(selectedPR.created_at)}
                    </span>
                  </div>
                </div>
                <div className="flex-1 flex items-center justify-center px-8">
                  <p className="text-xs text-center" style={{ color: 'var(--text-dimmed)' }}>
                    Ouvrez sur GitHub pour voir les review et la discussion complète
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full gap-3 px-8">
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
                  style={{ backgroundColor: 'rgba(14,165,233,0.08)', border: '1px solid rgba(14,165,233,0.15)' }}>
                  <GitPullRequest size={20} style={{ color: 'var(--accent-primary)', opacity: 0.4 }} />
                </div>
                <p className="text-xs" style={{ color: 'var(--text-dimmed)' }}>Cliquez sur une PR pour voir ses détails</p>
              </div>
            )
          )}

          {/* Notifications → summary */}
          {tab === 'notifications' && (
            <div className="flex flex-col items-center justify-center h-full gap-4 px-8 text-center">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
                style={{
                  backgroundColor: unreadCount > 0 ? 'rgba(239,68,68,0.08)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${unreadCount > 0 ? 'rgba(239,68,68,0.2)' : 'var(--border-base)'}`,
                }}>
                <Bell size={24} style={{ color: unreadCount > 0 ? '#f87171' : 'var(--text-dimmed)', opacity: 0.6 }} />
              </div>
              {unreadCount > 0 ? (
                <div>
                  <p className="text-sm font-bold" style={{ color: '#f87171' }}>
                    {unreadCount} notification{unreadCount > 1 ? 's' : ''} non lue{unreadCount > 1 ? 's' : ''}
                  </p>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-dimmed)' }}>
                    Consultez GitHub pour les marquer comme lues
                  </p>
                </div>
              ) : (
                <p className="text-sm" style={{ color: 'var(--text-dimmed)' }}>Toutes les notifications sont lues</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
