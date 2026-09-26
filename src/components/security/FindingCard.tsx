/**
 * FindingCard.tsx
 * Rich card for a single security finding — CWE icon, scanner badge,
 * EPSS score, KEV indicator, triage status selector.
 */
import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ChevronDown, ChevronUp, ExternalLink, Copy, CheckCheck,
  AlertCircle, AlertTriangle, Info, Flame, Shield,
} from 'lucide-react';
import { SeverityBadge, CvssBar, type Severity } from './SeverityBadge.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type FindingStatus = 'open' | 'confirmed' | 'false_positive' | 'fixed' | 'ignored';
export type ScannerCategory = 'sast' | 'sca' | 'secrets' | 'iac' | 'dast';

export interface FindingCardData {
  id: string;
  title: string;
  severity: Severity;
  scanner: ScannerCategory;
  cwe?: string;
  owasp?: string;
  description: string;
  remediation?: string;
  location?: { filePath: string; line?: number; snippet?: string };
  cvssScore?: number;
  epssScore?: number;
  cisaKev?: boolean;
  status: FindingStatus;
  firstSeen?: string;
  lastSeen?: string;
}

interface FindingCardProps {
  finding: FindingCardData;
  expanded?: boolean;
  onStatusChange?: (id: string, status: FindingStatus) => void;
  onClick?: (id: string) => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SCANNER_META: Record<ScannerCategory, { label: string; color: string; bg: string }> = {
  sast:    { label: 'SAST',    color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
  sca:     { label: 'SCA',     color: '#f97316', bg: 'rgba(249,115,22,0.12)' },
  secrets: { label: 'Secrets', color: '#a855f7', bg: 'rgba(168,85,247,0.12)' },
  iac:     { label: 'IaC',     color: '#3b82f6', bg: 'rgba(59,130,246,0.12)' },
  dast:    { label: 'DAST',    color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
};

const STATUS_OPTIONS: { value: FindingStatus; label: string; color: string }[] = [
  { value: 'open',           label: 'Ouvert',       color: '#ef4444' },
  { value: 'confirmed',      label: 'Confirmé',     color: '#f59e0b' },
  { value: 'false_positive', label: 'Faux positif', color: '#6b7280' },
  { value: 'fixed',          label: 'Corrigé',      color: '#22c55e' },
  { value: 'ignored',        label: 'Ignoré',       color: '#6b7280' },
];

// ─── FindingCard ──────────────────────────────────────────────────────────────

export function FindingCard({ finding, expanded: defaultExpanded = false, onStatusChange, onClick }: FindingCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState<FindingStatus>(finding.status);

  const scanner = SCANNER_META[finding.scanner];
  const statusCfg = STATUS_OPTIONS.find((s) => s.value === status)!;

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(finding.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleStatus = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value as FindingStatus;
    setStatus(next);
    onStatusChange?.(finding.id, next);
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      style={{
        background: 'var(--surface, rgba(255,255,255,0.04))',
        border: '1px solid var(--border, rgba(255,255,255,0.08))',
        borderRadius: 'var(--radius-lg, 8px)',
        overflow: 'hidden',
        marginBottom: 8,
        cursor: 'pointer',
        transition: 'border-color 0.15s',
      }}
      whileHover={{ borderColor: 'rgba(255,255,255,0.15)' }}
      onClick={() => { setExpanded(!expanded); onClick?.(finding.id); }}
    >
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px' }}>
        {/* Severity */}
        <SeverityBadge severity={finding.severity} animated={finding.severity === 'critical'} />

        {/* Scanner tag */}
        <span style={{
          fontSize: 11, fontWeight: 700, padding: '3px 7px',
          borderRadius: 'var(--radius-sm)', letterSpacing: '0.05em',
          background: scanner.bg, color: scanner.color, fontFamily: 'var(--font-mono)',
        }}>
          {scanner.label}
        </span>

        {/* KEV badge */}
        {finding.cisaKev && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            fontSize: 10, fontWeight: 700, padding: '3px 7px',
            borderRadius: 'var(--radius-sm)', background: 'rgba(220,38,38,0.18)',
            color: '#dc2626', border: '1px solid rgba(220,38,38,0.4)',
            letterSpacing: '0.06em', fontFamily: 'var(--font-mono)',
          }}>
            <Flame size={10} /> KEV
          </span>
        )}

        {/* Title */}
        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--text-primary, #f1f5f9)', lineHeight: 1.3 }}>
          {finding.title}
        </span>

        {/* CWE */}
        {finding.cwe && (
          <span style={{ fontSize: 11, color: 'var(--text-muted, #6b7280)', fontFamily: 'var(--font-mono)' }}>
            {finding.cwe}
          </span>
        )}

        {/* EPSS */}
        {finding.epssScore !== undefined && (
          <span title="EPSS — probabilité d'exploitation dans les 30 jours" style={{
            fontSize: 11, fontWeight: 600, padding: '2px 6px',
            borderRadius: 'var(--radius-sm)', background: 'rgba(251,146,60,0.12)',
            color: finding.epssScore > 0.7 ? '#f97316' : '#94a3b8',
            fontFamily: 'var(--font-mono)',
          }}>
            EPSS {(finding.epssScore * 100).toFixed(0)}%
          </span>
        )}

        {/* Status */}
        <select
          value={status}
          onChange={handleStatus}
          onClick={(e) => e.stopPropagation()}
          style={{
            fontSize: 11, fontWeight: 600, padding: '4px 8px',
            borderRadius: 'var(--radius-sm)', border: '1px solid rgba(255,255,255,0.1)',
            background: 'var(--surface-2, rgba(255,255,255,0.06))',
            color: statusCfg.color, cursor: 'pointer', outline: 'none',
          }}
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value} style={{ color: o.color }}>{o.label}</option>
          ))}
        </select>

        {/* Expand toggle */}
        <motion.span animate={{ rotate: expanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronDown size={15} style={{ color: 'var(--text-muted, #6b7280)' }} />
        </motion.span>
      </div>

      {/* ── Expanded body ── */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: 'easeInOut' }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{
              padding: '0 16px 16px',
              borderTop: '1px solid var(--border, rgba(255,255,255,0.07))',
              paddingTop: 14,
              display: 'flex', flexDirection: 'column', gap: 12,
            }}>
              {/* File location */}
              {finding.location && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: '#60a5fa' }}>
                    {finding.location.filePath}
                    {finding.location.line !== undefined && (
                      <span style={{ color: '#94a3b8' }}>:{finding.location.line}</span>
                    )}
                  </span>
                  <button
                    onClick={handleCopy}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}
                    title="Copier l'ID"
                  >
                    {copied ? <CheckCheck size={13} color="#22c55e" /> : <Copy size={13} color="#6b7280" />}
                  </button>
                </div>
              )}

              {/* Code snippet */}
              {finding.location?.snippet && (
                <pre style={{
                  margin: 0, padding: '10px 14px',
                  background: 'rgba(0,0,0,0.35)', borderRadius: 'var(--radius-md)',
                  fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.6,
                  color: '#e2e8f0', overflow: 'auto', maxHeight: 160,
                  border: '1px solid rgba(255,255,255,0.06)',
                }}>
                  {finding.location.snippet}
                </pre>
              )}

              {/* CVSS bar */}
              {finding.cvssScore !== undefined && (
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>CVSS Score</div>
                  <CvssBar score={finding.cvssScore} />
                </div>
              )}

              {/* Description */}
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary, #94a3b8)', lineHeight: 1.65 }}>
                {finding.description}
              </p>

              {/* OWASP */}
              {finding.owasp && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 'var(--radius-sm)',
                    background: 'rgba(168,85,247,0.12)', color: '#a855f7',
                    fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                    {finding.owasp}
                  </span>
                </div>
              )}

              {/* Remediation */}
              {finding.remediation && (
                <div style={{
                  padding: '10px 14px',
                  background: 'rgba(34,197,94,0.06)',
                  border: '1px solid rgba(34,197,94,0.2)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 12, color: '#86efac', lineHeight: 1.6,
                  display: 'flex', gap: 8, alignItems: 'flex-start',
                }}>
                  <Shield size={14} style={{ marginTop: 2, flexShrink: 0, color: '#22c55e' }} />
                  <span>{finding.remediation}</span>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
