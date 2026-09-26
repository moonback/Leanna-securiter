import React, { useState, useCallback, useEffect } from 'react';
import {
  Github, GitPullRequest, AlertCircle, Bell, Star,
  ExternalLink, RefreshCw, Loader2, BookOpen, GitCommit,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { ViewHeader } from '../components/ui/ViewHeader.js';
import { WorkspacePublishPanel } from '../components/github/WorkspacePublishPanel.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface RepoInfo {
  owner: string;
  repo: string;
  full_name: string;
  remoteUrl: string;
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
  status: string; // A, M, D, R
  path: string;
}

type Tab = 'commits' | 'issues' | 'prs';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}j`;
}

/** Open external URL — uses Electron shell if available, otherwise window.open */
function openExternal(url: string) {
  const api = (window as any).electronAPI;
  if (api?.openExternal) {
    api.openExternal(url);
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function GitHubView() {
  const [repoInfo, setRepoInfo] = useState<RepoInfo | null>(null);
  const [detecting, setDetecting] = useState(true);
  const [noRepo, setNoRepo] = useState(false);

  const [tab, setTab] = useState<Tab>('commits');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [commits, setCommits] = useState<Commit[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [prs, setPrs] = useState<PullRequest[]>([]);

  // Commit detail
  const [selectedCommit, setSelectedCommit] = useState<CommitDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // ─── Detect current project repo ──────────────────────────────────────

  const detectRepo = useCallback(async () => {
    setDetecting(true);
    setNoRepo(false);
    setError(null);
    try {
      const res = await fetch('/api/github/current-repo');
      const data = await res.json();
      if (data.status === 'success' && data.owner && data.repo) {
        setRepoInfo({ owner: data.owner, repo: data.repo, full_name: data.full_name, remoteUrl: data.remoteUrl });
      } else {
        setNoRepo(true);
      }
    } catch {
      setNoRepo(true);
    } finally {
      setDetecting(false);
    }
  }, []);

  useEffect(() => { detectRepo(); }, [detectRepo]);

  // ─── Fetch issues & PRs ───────────────────────────────────────────────

  const fetchIssues = useCallback(async () => {
    if (!repoInfo) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ owner: repoInfo.owner, repo: repoInfo.repo });
      const res = await fetch(`/api/github/issues?${params}`);
      const data = await res.json();
      if (data.error) { setError(data.error); return; }
      setIssues(data.issues || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [repoInfo]);

  const fetchPRs = useCallback(async () => {
    if (!repoInfo) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ owner: repoInfo.owner, repo: repoInfo.repo });
      const res = await fetch(`/api/github/pulls?${params}`);
      const data = await res.json();
      if (data.error) { setError(data.error); return; }
      setPrs(data.pull_requests || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [repoInfo]);

  const fetchCommits = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/github/commits?limit=30');
      const data = await res.json();
      if (data.error) { setError(data.error); return; }
      setCommits(data.commits || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchCommitDetail = useCallback(async (hash: string) => {
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/github/commits/${hash}`);
      const data = await res.json();
      if (data.error) { setError(data.error); return; }
      setSelectedCommit(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  // Load data when repo is detected or tab changes
  useEffect(() => {
    if (!repoInfo) return;
    if (tab === 'commits') fetchCommits();
    else if (tab === 'issues') fetchIssues();
    else fetchPRs();
  }, [repoInfo, tab, fetchCommits, fetchIssues, fetchPRs]);

  const refresh = useCallback(() => {
    if (tab === 'commits') fetchCommits();
    else if (tab === 'issues') fetchIssues();
    else fetchPRs();
  }, [tab, fetchCommits, fetchIssues, fetchPRs]);

  const githubUrl = repoInfo ? `https://github.com/${repoInfo.full_name}` : null;

  // ─── Loading / No repo state ──────────────────────────────────────────

  if (detecting) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3" style={{ backgroundColor: 'var(--bg-main)' }}>
        <Loader2 size={24} className="animate-spin" style={{ color: 'var(--accent-primary)' }} />
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Détection du repo GitHub…</p>
      </div>
    );
  }

  if (noRepo || !repoInfo) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 px-6 text-center" style={{ backgroundColor: 'var(--bg-main)' }}>
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center"
          style={{ backgroundColor: 'rgba(14,165,233,0.08)', border: '1px solid rgba(14,165,233,0.2)' }}
        >
          <Github size={32} style={{ color: 'var(--text-dimmed)', opacity: 0.5 }} />
        </div>
        <div>
          <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Aucun repo GitHub détecté</p>
          <p className="text-xs max-w-sm" style={{ color: 'var(--text-muted)' }}>
            Le workspace actuel ne contient pas de remote Git pointant vers GitHub.
            Assurez-vous que le projet a un remote <code className="font-mono px-1 py-0.5 rounded" style={{ backgroundColor: 'var(--bg-input)' }}>origin</code> configuré.
          </p>
        </div>
        <button
          onClick={detectRepo}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-colors"
          style={{ backgroundColor: 'var(--accent-primary)', color: '#fff' }}
        >
          <RefreshCw size={14} /> Réessayer
        </button>
      </div>
    );
  }

  // ─── Main render ──────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ backgroundColor: 'var(--bg-base)' }}>
      {/* ── Header ─────────────────────────────────────────── */}
      <ViewHeader
        icon={Github}
        title={repoInfo.full_name}
        description={repoInfo.remoteUrl}
        actions={
          <>
            <button
              onClick={refresh}
              className="rounded-lg p-2 transition-colors hover:bg-white/10"
              title="Rafraîchir"
              aria-label="Rafraîchir"
            >
              {loading
                ? <Loader2 size={16} className="animate-spin" style={{ color: 'var(--text-muted)' }} />
                : <RefreshCw size={16} style={{ color: 'var(--text-muted)' }} />
              }
            </button>
            {githubUrl && (
              <button
                onClick={() => openExternal(githubUrl)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[10px] font-semibold transition-opacity hover:opacity-80"
                style={{ backgroundColor: 'var(--accent-subtle)', color: 'var(--accent-primary)', border: '1px solid var(--border-base)' }}
                aria-label="Ouvrir sur GitHub"
              >
                <ExternalLink size={14} />
                Ouvrir sur GitHub
              </button>
            )}
          </>
        }
      />

      <div className="flex-shrink-0 px-6 pt-4">
        <WorkspacePublishPanel onPublished={fetchCommits} />
      </div>

      {/* ── Tabs ───────────────────────────────────────────── */}
      <div
        className="flex gap-1 px-6 py-2 border-b flex-shrink-0"
        style={{ borderColor: 'var(--border-base)' }}
        role="tablist"
        aria-label="Onglets GitHub"
      >
        <button
          onClick={() => setTab('commits')}
          role="tab"
          aria-selected={tab === 'commits'}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all"
          style={{
            backgroundColor: tab === 'commits' ? 'rgba(14,165,233,0.1)' : 'transparent',
            color: tab === 'commits' ? 'var(--accent-primary)' : 'var(--text-dimmed)',
            border: tab === 'commits' ? '1px solid rgba(14,165,233,0.2)' : '1px solid transparent',
          }}
        >
          <GitCommit size={14} />
          Commits
          {commits.length > 0 && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'rgba(14,165,233,0.15)', color: 'var(--accent-primary)' }}>
              {commits.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab('issues')}
          role="tab"
          aria-selected={tab === 'issues'}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all"
          style={{
            backgroundColor: tab === 'issues' ? 'rgba(14,165,233,0.1)' : 'transparent',
            color: tab === 'issues' ? 'var(--accent-primary)' : 'var(--text-dimmed)',
            border: tab === 'issues' ? '1px solid rgba(14,165,233,0.2)' : '1px solid transparent',
          }}
        >
          <AlertCircle size={14} />
          Issues
          {issues.length > 0 && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'rgba(14,165,233,0.15)', color: 'var(--accent-primary)' }}>
              {issues.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab('prs')}
          role="tab"
          aria-selected={tab === 'prs'}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all"
          style={{
            backgroundColor: tab === 'prs' ? 'rgba(14,165,233,0.1)' : 'transparent',
            color: tab === 'prs' ? 'var(--accent-primary)' : 'var(--text-dimmed)',
            border: tab === 'prs' ? '1px solid rgba(14,165,233,0.2)' : '1px solid transparent',
          }}
        >
          <GitPullRequest size={14} />
          Pull Requests
          {prs.length > 0 && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'rgba(14,165,233,0.15)', color: 'var(--accent-primary)' }}>
              {prs.length}
            </span>
          )}
        </button>
      </div>

      {/* ── Error ──────────────────────────────────────────── */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mx-6 mt-3 px-3 py-2 rounded-lg overflow-hidden"
            style={{ backgroundColor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)' }}
            role="alert"
          >
            <p className="text-[11px]" style={{ color: '#f87171' }}>{error}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Content ────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto custom-scrollbar px-6 py-4">
        {/* Loading */}
        {loading && commits.length === 0 && issues.length === 0 && prs.length === 0 && (
          <div className="flex items-center justify-center py-12 gap-2">
            <Loader2 size={16} className="animate-spin" style={{ color: 'var(--text-muted)' }} />
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Chargement…</span>
          </div>
        )}

        {/* ─── Commits ─────────────────────────────────── */}
        {tab === 'commits' && !loading && (
          <div className="flex gap-4">
            {/* Commit list */}
            <div className={`grid gap-1 ${selectedCommit ? 'w-1/2' : 'w-full'}`}>
              {commits.length === 0 ? (
                <p className="text-center text-xs py-8" style={{ color: 'var(--text-dimmed)' }}>
                  Aucun commit trouvé
                </p>
              ) : (
                commits.map((commit) => (
                  <div
                    key={commit.hash}
                    onClick={() => fetchCommitDetail(commit.hash)}
                    className="flex items-start gap-3 rounded-xl border p-3 transition-colors hover:bg-white/5 cursor-pointer"
                    style={{
                      borderColor: selectedCommit?.hash === commit.hash ? 'var(--accent-primary)' : 'var(--border-base)',
                      backgroundColor: selectedCommit?.hash === commit.hash ? 'rgba(14,165,233,0.05)' : undefined,
                    }}
                    role="button"
                    aria-label={`Commit ${commit.shortHash}: ${commit.message}`}
                  >
                    <GitCommit size={14} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--accent-primary)' }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                        {commit.message}
                      </p>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-[10px] font-semibold" style={{ color: 'var(--text-muted)' }}>{commit.author}</span>
                        <span className="text-[10px] font-mono" style={{ color: 'var(--accent-primary)', opacity: 0.8 }}>{commit.shortHash}</span>
                        <span className="text-[10px]" style={{ color: 'var(--text-dimmed)' }}>{timeAgo(commit.date)}</span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Commit detail panel */}
            <AnimatePresence>
              {selectedCommit && (
                <motion.div
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  className="w-1/2 rounded-xl border p-4 sticky top-0 self-start"
                  style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-panel)' }}
                >
                  {loadingDetail ? (
                    <div className="flex items-center justify-center py-8 gap-2">
                      <Loader2 size={16} className="animate-spin" style={{ color: 'var(--text-muted)' }} />
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Chargement…</span>
                    </div>
                  ) : (
                    <>
                      {/* Header */}
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-bold" style={{ color: 'var(--text-primary)' }}>
                            {selectedCommit.message}
                          </p>
                          <div className="flex items-center gap-3 mt-1.5">
                            <span className="text-[10px] font-semibold" style={{ color: 'var(--text-muted)' }}>{selectedCommit.author}</span>
                            <span className="text-[10px]" style={{ color: 'var(--text-dimmed)' }}>{new Date(selectedCommit.date).toLocaleString('fr-FR')}</span>
                          </div>
                          <span className="text-[10px] font-mono mt-1 inline-block px-1.5 py-0.5 rounded" style={{ backgroundColor: 'rgba(14,165,233,0.1)', color: 'var(--accent-primary)' }}>
                            {selectedCommit.hash.slice(0, 10)}
                          </span>
                        </div>
                        <div className="flex gap-1">
                          <button
                            onClick={() => openExternal(`https://github.com/${repoInfo.full_name}/commit/${selectedCommit.hash}`)}
                            className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
                            title="Voir sur GitHub"
                            aria-label="Voir sur GitHub"
                          >
                            <ExternalLink size={14} style={{ color: 'var(--accent-primary)' }} />
                          </button>
                          <button
                            onClick={() => setSelectedCommit(null)}
                            className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
                            title="Fermer"
                            aria-label="Fermer le détail"
                          >
                            <span className="text-xs" style={{ color: 'var(--text-dimmed)' }}>✕</span>
                          </button>
                        </div>
                      </div>

                      {/* Files changed */}
                      <div className="border-t pt-3 mt-3" style={{ borderColor: 'var(--border-base)' }}>
                        <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-dimmed)' }}>
                          Fichiers modifiés ({selectedCommit.files.length})
                        </p>
                        <div className="grid gap-1 max-h-[400px] overflow-y-auto custom-scrollbar">
                          {selectedCommit.files.map((file) => (
                            <div
                              key={file.path}
                              className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-[11px] font-mono"
                              style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}
                            >
                              <span
                                className="w-4 h-4 rounded flex items-center justify-center text-[9px] font-bold flex-shrink-0"
                                style={{
                                  backgroundColor: file.status === 'A' ? 'rgba(63,185,80,0.15)' :
                                                   file.status === 'D' ? 'rgba(248,81,73,0.15)' :
                                                   file.status === 'R' ? 'rgba(163,113,247,0.15)' :
                                                   'rgba(14,165,233,0.15)',
                                  color: file.status === 'A' ? '#3fb950' :
                                         file.status === 'D' ? '#f85149' :
                                         file.status === 'R' ? '#a371f7' :
                                         'var(--accent-primary)',
                                }}
                              >
                                {file.status}
                              </span>
                              <span className="truncate" style={{ color: 'var(--text-primary)' }}>{file.path}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* ─── Issues ──────────────────────────────────── */}
        {tab === 'issues' && !loading && (
          <div className="grid gap-2">
            {issues.length === 0 ? (
              <p className="text-center text-xs py-8" style={{ color: 'var(--text-dimmed)' }}>
                Aucune issue ouverte sur ce repo
              </p>
            ) : (
              issues.map((issue) => (
                <div
                  key={issue.number}
                  onClick={() => openExternal(issue.html_url)}
                  className="flex items-start gap-3 rounded-xl border p-3 transition-colors hover:bg-white/5 cursor-pointer"
                  style={{ borderColor: 'var(--border-base)' }}
                  role="link"
                  aria-label={`Issue #${issue.number}: ${issue.title}`}
                >
                  <AlertCircle size={14} className="mt-0.5 flex-shrink-0" style={{ color: issue.state === 'open' ? '#3fb950' : '#f85149' }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-medium" style={{ color: 'var(--text-primary)' }}>
                      #{issue.number} {issue.title}
                    </p>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-[10px]" style={{ color: 'var(--text-dimmed)' }}>{issue.author}</span>
                      <span className="text-[10px]" style={{ color: 'var(--text-dimmed)' }}>{timeAgo(issue.created_at)}</span>
                      {issue.comments > 0 && <span className="text-[10px]" style={{ color: 'var(--text-dimmed)' }}>💬 {issue.comments}</span>}
                    </div>
                    {issue.labels.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {issue.labels.slice(0, 4).map((l) => (
                          <span key={l} className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'rgba(255,255,255,0.06)', color: 'var(--text-muted)' }}>
                            {l}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <ExternalLink size={12} style={{ color: 'var(--text-dimmed)' }} className="flex-shrink-0 mt-1" />
                </div>
              ))
            )}
          </div>
        )}

        {/* ─── Pull Requests ───────────────────────────── */}
        {tab === 'prs' && !loading && (
          <div className="grid gap-2">
            {prs.length === 0 ? (
              <p className="text-center text-xs py-8" style={{ color: 'var(--text-dimmed)' }}>
                Aucune PR ouverte sur ce repo
              </p>
            ) : (
              prs.map((pr) => (
                <div
                  key={pr.number}
                  onClick={() => openExternal(pr.html_url)}
                  className="flex items-start gap-3 rounded-xl border p-3 transition-colors hover:bg-white/5 cursor-pointer"
                  style={{ borderColor: 'var(--border-base)' }}
                  role="link"
                  aria-label={`PR #${pr.number}: ${pr.title}`}
                >
                  <GitPullRequest size={14} className="mt-0.5 flex-shrink-0" style={{ color: pr.state === 'open' ? '#3fb950' : '#a371f7' }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-medium" style={{ color: 'var(--text-primary)' }}>
                      #{pr.number} {pr.title}
                    </p>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-[10px]" style={{ color: 'var(--text-dimmed)' }}>{pr.author}</span>
                      <span className="text-[10px] font-mono" style={{ color: 'var(--text-dimmed)' }}>
                        {pr.head} → {pr.base}
                      </span>
                      {pr.draft && (
                        <span className="text-[8px] px-1.5 py-0.5 rounded-full font-bold uppercase" style={{ backgroundColor: 'rgba(255,255,255,0.06)', color: 'var(--text-dimmed)' }}>
                          draft
                        </span>
                      )}
                    </div>
                  </div>
                  <ExternalLink size={12} style={{ color: 'var(--text-dimmed)' }} className="flex-shrink-0 mt-1" />
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
