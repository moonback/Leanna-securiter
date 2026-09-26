/**
 * SbomTable.tsx
 * Software Bill of Materials viewer — package list with CVE count, EPSS,
 * CISA KEV flag, licence, and transitive depth indicator.
 */
import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Package, ChevronUp, ChevronDown, Search, AlertTriangle, Flame, Shield } from 'lucide-react';

export interface SbomEntry {
  name: string;
  version: string;
  license?: string;
  ecosystem?: string; // 'npm' | 'PyPI' | 'Go' | …
  cveCount?: number;
  maxCvss?: number;
  maxEpss?: number;
  cisaKev?: boolean;
  transitive?: boolean;
  fixedVersion?: string;
}

interface SbomTableProps {
  components: SbomEntry[];
  title?: string;
}

type SortKey = 'name' | 'cveCount' | 'maxCvss' | 'maxEpss';

const ECOSYSTEM_COLORS: Record<string, string> = {
  npm:   '#f59e0b',
  pypi:  '#3b82f6',
  go:    '#06b6d4',
  cargo: '#f97316',
  maven: '#a855f7',
};

function LicenseTag({ license }: { license?: string }) {
  if (!license) return null;
  const risky = ['GPL', 'AGPL', 'SSPL', 'BUSL'].some((l) => license.toUpperCase().includes(l));
  return (
    <span style={{
      fontSize: 10, padding: '2px 6px', borderRadius: 'var(--radius-sm)',
      fontFamily: 'var(--font-mono)', fontWeight: 600, letterSpacing: '0.04em',
      background: risky ? 'rgba(239,68,68,0.12)' : 'rgba(255,255,255,0.06)',
      color: risky ? '#f87171' : '#94a3b8',
      border: risky ? '1px solid rgba(239,68,68,0.25)' : '1px solid rgba(255,255,255,0.08)',
    }}>
      {license}
    </span>
  );
}

function CvssCell({ score }: { score?: number }) {
  if (score === undefined) return <span style={{ color: '#4b5563' }}>—</span>;
  const color = score >= 9 ? '#dc2626' : score >= 7 ? '#ea580c' : score >= 4 ? '#d97706' : '#22c55e';
  return (
    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 13, color }}>
      {score.toFixed(1)}
    </span>
  );
}

export function SbomTable({ components, title }: SbomTableProps) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('cveCount');
  const [sortAsc, setSortAsc] = useState(false);
  const [showTransitive, setShowTransitive] = useState(false);

  const filtered = useMemo(() => {
    let list = components;
    if (!showTransitive) list = list.filter((c) => !c.transitive);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((c) => c.name.toLowerCase().includes(q) || c.version.includes(q));
    }
    list = [...list].sort((a, b) => {
      let v = 0;
      if (sortKey === 'name')     v = a.name.localeCompare(b.name);
      if (sortKey === 'cveCount') v = (a.cveCount ?? 0) - (b.cveCount ?? 0);
      if (sortKey === 'maxCvss')  v = (a.maxCvss ?? 0)  - (b.maxCvss ?? 0);
      if (sortKey === 'maxEpss')  v = (a.maxEpss ?? 0)  - (b.maxEpss ?? 0);
      return sortAsc ? v : -v;
    });
    return list;
  }, [components, search, sortKey, sortAsc, showTransitive]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  const SortIcon = ({ k }: { k: SortKey }) =>
    sortKey === k
      ? (sortAsc ? <ChevronUp size={12} /> : <ChevronDown size={12} />)
      : <ChevronDown size={12} style={{ opacity: 0.25 }} />;

  const totalVulnerable = components.filter((c) => (c.cveCount ?? 0) > 0).length;
  const totalKev = components.filter((c) => c.cisaKev).length;

  return (
    <div style={{
      background: 'rgba(13,17,23,0.85)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 'var(--radius-lg)',
      overflow: 'hidden',
    }}>
      {/* ── Header ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '12px 16px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        flexWrap: 'wrap',
      }}>
        <Package size={15} color="#f59e0b" />
        <span style={{ fontSize: 13, fontWeight: 600, color: '#fde68a' }}>
          {title ?? 'SBOM — Dépendances'}
        </span>
        <span style={{ fontSize: 11, color: '#6b7280', marginLeft: 4 }}>
          {components.length} composants
        </span>
        {totalVulnerable > 0 && (
          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 'var(--radius-full)',
            background: 'rgba(239,68,68,0.12)', color: '#f87171', fontWeight: 600 }}>
            <AlertTriangle size={10} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
            {totalVulnerable} vulnérable{totalVulnerable > 1 ? 's' : ''}
          </span>
        )}
        {totalKev > 0 && (
          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 'var(--radius-full)',
            background: 'rgba(220,38,38,0.15)', color: '#dc2626', fontWeight: 700 }}>
            <Flame size={10} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
            {totalKev} KEV
          </span>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Search */}
          <div style={{ position: 'relative' }}>
            <Search size={12} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: '#4b5563' }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filtrer…"
              style={{
                paddingLeft: 28, paddingRight: 10, paddingTop: 5, paddingBottom: 5,
                fontSize: 12, background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 'var(--radius-md)', color: '#e2e8f0', outline: 'none', width: 150,
              }}
            />
          </div>
          {/* Transitive toggle */}
          <button
            onClick={() => setShowTransitive(!showTransitive)}
            style={{
              fontSize: 11, padding: '4px 10px', borderRadius: 'var(--radius-md)',
              background: showTransitive ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: showTransitive ? '#818cf8' : '#6b7280', cursor: 'pointer', fontWeight: 600,
            }}>
            Transitifs
          </button>
        </div>
      </div>

      {/* ── Table ── */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)' }}>
              {[
                { key: 'name' as SortKey, label: 'Package', align: 'left' },
                { key: null, label: 'Version', align: 'left' },
                { key: null, label: 'Licence', align: 'left' },
                { key: 'cveCount' as SortKey, label: 'CVE', align: 'center' },
                { key: 'maxCvss' as SortKey, label: 'CVSS', align: 'center' },
                { key: 'maxEpss' as SortKey, label: 'EPSS', align: 'center' },
                { key: null, label: 'Fix', align: 'left' },
              ].map((col, i) => (
                <th key={i}
                  onClick={col.key ? () => toggleSort(col.key!) : undefined}
                  style={{
                    padding: '8px 12px', fontWeight: 600, fontSize: 11, letterSpacing: '0.06em',
                    color: '#6b7280', textAlign: col.align as any,
                    cursor: col.key ? 'pointer' : 'default', userSelect: 'none',
                    whiteSpace: 'nowrap',
                  }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    {col.label.toUpperCase()}
                    {col.key && <SortIcon k={col.key} />}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <AnimatePresence mode="popLayout">
              {filtered.map((comp) => (
                <motion.tr
                  key={comp.name + comp.version}
                  layout
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  style={{
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                    background: comp.cisaKev ? 'rgba(220,38,38,0.04)' : undefined,
                  }}
                  whileHover={{ background: 'rgba(255,255,255,0.03)' }}
                >
                  {/* Package name */}
                  <td style={{ padding: '9px 12px', color: '#e2e8f0', fontFamily: 'var(--font-mono)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      {comp.ecosystem && (
                        <span style={{
                          fontSize: 9, padding: '1px 5px', borderRadius: 'var(--radius-sm)',
                          background: (ECOSYSTEM_COLORS[comp.ecosystem.toLowerCase()] ?? '#6b7280') + '25',
                          color: ECOSYSTEM_COLORS[comp.ecosystem.toLowerCase()] ?? '#6b7280',
                          fontWeight: 700, letterSpacing: '0.06em',
                        }}>
                          {comp.ecosystem.toUpperCase()}
                        </span>
                      )}
                      <span style={{ fontWeight: comp.transitive ? 400 : 600, opacity: comp.transitive ? 0.7 : 1 }}>
                        {comp.name}
                      </span>
                      {comp.cisaKev && (
                      <span title="CISA KEV">
                        <Flame size={11} color="#dc2626" />
                      </span>
                    )}
                    </div>
                  </td>
                  {/* Version */}
                  <td style={{ padding: '9px 12px', color: '#94a3b8', fontFamily: 'var(--font-mono)' }}>
                    {comp.version}
                  </td>
                  {/* Licence */}
                  <td style={{ padding: '9px 12px' }}>
                    <LicenseTag license={comp.license} />
                  </td>
                  {/* CVE count */}
                  <td style={{ padding: '9px 12px', textAlign: 'center' }}>
                    {(comp.cveCount ?? 0) > 0 ? (
                      <span style={{ fontWeight: 700, color: '#f87171', fontFamily: 'var(--font-mono)' }}>
                        {comp.cveCount}
                      </span>
                    ) : <span style={{ color: '#4b5563' }}>—</span>}
                  </td>
                  {/* CVSS */}
                  <td style={{ padding: '9px 12px', textAlign: 'center' }}>
                    <CvssCell score={comp.maxCvss} />
                  </td>
                  {/* EPSS */}
                  <td style={{ padding: '9px 12px', textAlign: 'center', fontFamily: 'var(--font-mono)' }}>
                    {comp.maxEpss !== undefined
                      ? <span style={{ color: comp.maxEpss > 0.5 ? '#f97316' : '#94a3b8' }}>
                          {(comp.maxEpss * 100).toFixed(0)}%
                        </span>
                      : <span style={{ color: '#4b5563' }}>—</span>}
                  </td>
                  {/* Fix */}
                  <td style={{ padding: '9px 12px', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                    {comp.fixedVersion ? (
                      <span style={{ color: '#4ade80', display: 'flex', alignItems: 'center', gap: 5 }}>
                        <Shield size={11} /> {comp.fixedVersion}
                      </span>
                    ) : <span style={{ color: '#4b5563' }}>—</span>}
                  </td>
                </motion.tr>
              ))}
            </AnimatePresence>
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div style={{ padding: 32, textAlign: 'center', color: '#4b5563', fontSize: 13 }}>
            Aucun composant trouvé
          </div>
        )}
      </div>
    </div>
  );
}
