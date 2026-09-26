/**
 * RichDocumentViewer — Affichage de documents riches créés par Leanna
 *
 * Supporte : table, bar_chart, line_chart, area_chart, pie_chart,
 *            card, list, text (markdown), code, progress, timeline, stat_grid
 */

import { memo, useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { marked } from 'marked';
import { sanitizeMarkdownHtml } from '../../utils/sanitizeMarkdownHtml.js';
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area, PieChart, Pie,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, Cell, ResponsiveContainer,
} from 'recharts';
import {
  X, Download, ChevronDown, ChevronUp, Table2, BarChart2,
  TrendingUp, PieChart as PieIcon, FileText, List, Layers,
  Code2, Activity, GitCommitVertical, LayoutGrid,
  Copy, Check, ArrowUpRight, ArrowDownRight, Minus,
  Search, FileDown, Save, FolderOpen, CheckCircle2, AlertCircle, Loader2,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

export type RichBlockType =
  | 'table' | 'bar_chart' | 'line_chart' | 'area_chart' | 'pie_chart'
  | 'card' | 'list' | 'text' | 'code' | 'progress' | 'timeline' | 'stat_grid';

export interface TableBlock {
  type: 'table';
  title?: string;
  columns: string[];
  rows: (string | number)[][];
}

export interface ChartDataPoint {
  label: string;
  [key: string]: string | number;
}

export interface BarChartBlock {
  type: 'bar_chart';
  title?: string;
  data: ChartDataPoint[];
  series: { key: string; label?: string; color?: string }[];
  xLabel?: string;
  yLabel?: string;
  stacked?: boolean;
  height?: 'sm' | 'md' | 'lg';
}

export interface LineChartBlock {
  type: 'line_chart';
  title?: string;
  data: ChartDataPoint[];
  series: { key: string; label?: string; color?: string }[];
  xLabel?: string;
  yLabel?: string;
  smooth?: boolean;
  height?: 'sm' | 'md' | 'lg';
}

export interface AreaChartBlock {
  type: 'area_chart';
  title?: string;
  data: ChartDataPoint[];
  series: { key: string; label?: string; color?: string }[];
  xLabel?: string;
  yLabel?: string;
  stacked?: boolean;
  height?: 'sm' | 'md' | 'lg';
}

export interface PieChartBlock {
  type: 'pie_chart';
  title?: string;
  data: { label: string; value: number; color?: string }[];
  donut?: boolean;
  height?: 'sm' | 'md' | 'lg';
}

export interface CardField {
  label: string;
  value: string | number;
  highlight?: boolean;
}

export interface CardBlock {
  type: 'card';
  title?: string;
  subtitle?: string;
  fields: CardField[];
  badge?: { text: string; color?: string };
}

export interface ListBlock {
  type: 'list';
  title?: string;
  items: { text: string; sub?: string; icon?: string; badge?: string }[];
  ordered?: boolean;
}

export interface TextBlock {
  type: 'text';
  title?: string;
  content: string;
  /** Interpréter comme Markdown — défaut true */
  markdown?: boolean;
}

export interface CodeBlock {
  type: 'code';
  title?: string;
  language?: string;
  content: string;
}

export interface ProgressItem {
  label: string;
  value: number;
  max?: number;
  color?: string;
  unit?: string;
}

export interface ProgressBlock {
  type: 'progress';
  title?: string;
  items: ProgressItem[];
}

export interface TimelineEvent {
  date: string;
  title: string;
  description?: string;
  status?: 'done' | 'current' | 'upcoming' | 'error';
  badge?: string;
}

export interface TimelineBlock {
  type: 'timeline';
  title?: string;
  events: TimelineEvent[];
}

export interface StatItem {
  label: string;
  value: string | number;
  unit?: string;
  change?: number;
  changeLabel?: string;
  color?: string;
  icon?: string;
}

export interface StatGridBlock {
  type: 'stat_grid';
  title?: string;
  items: StatItem[];
  columns?: 2 | 3 | 4;
}

export type RichBlock =
  | TableBlock | BarChartBlock | LineChartBlock | AreaChartBlock
  | PieChartBlock | CardBlock | ListBlock | TextBlock
  | CodeBlock | ProgressBlock | TimelineBlock | StatGridBlock;

export interface RichDocument {
  title: string;
  subtitle?: string;
  createdAt?: string;
  blocks: RichBlock[];
}

// ─── Palette ──────────────────────────────────────────────────────────────────

const CHART_COLORS = [
  'var(--color-accent-alt)', 'var(--accent-secondary)', 'var(--color-success)', 'var(--color-warning)',
  'var(--color-error)', 'var(--color-accent-alt)', 'var(--color-warning)', 'var(--color-success)',
  'var(--accent-primary)', 'var(--color-accent-alt)',
];

function getColor(index: number, override?: string): string {
  return override ?? CHART_COLORS[index % CHART_COLORS.length];
}

const CHART_HEIGHTS: Record<'sm' | 'md' | 'lg', number> = { sm: 180, md: 260, lg: 380 };

// ─── Utilitaires UI ───────────────────────────────────────────────────────────

function useCopy(text: string) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }, [text]);
  return { copied, copy };
}


function ChartSizePicker({
  value,
  onChange,
}: {
  value: 'sm' | 'md' | 'lg';
  onChange: (v: 'sm' | 'md' | 'lg') => void;
}) {
  return (
    <div
      className="flex items-center rounded-lg overflow-hidden flex-shrink-0"
      style={{ border: '1px solid var(--border-base)' }}
    >
      {(['sm', 'md', 'lg'] as const).map((s) => (
        <button
          key={s}
          onClick={() => onChange(s)}
          className="px-2 py-0.5 text-xs font-mono uppercase transition-colors"
          style={{
            backgroundColor: value === s ? 'var(--accent-primary)' : 'transparent',
            color: value === s ? 'white' : 'var(--text-dimmed)',
          }}
        >
          {s}
        </button>
      ))}
    </div>
  );
}

// ─── Tooltip partagé ─────────────────────────────────────────────────────────

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="px-3 py-2 rounded-xl text-xs shadow-xl"
      style={{
        backgroundColor: 'var(--bg-panel)',
        border: '1px solid var(--border-base)',
        color: 'var(--text-primary)',
      }}
    >
      {label && (
        <p className="font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>
          {label}
        </p>
      )}
      {payload.map((entry: any, i: number) => (
        <p key={i} style={{ color: entry.color }}>
          {entry.name}:{' '}
          <span className="font-bold">{entry.value?.toLocaleString?.() ?? entry.value}</span>
        </p>
      ))}
    </div>
  );
}

// ─── BlockTitle ───────────────────────────────────────────────────────────────

function BlockTitle({ title }: { title?: string }) {
  if (!title) return null;
  return (
    <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
      {title}
    </p>
  );
}

// ─── TableRenderer ────────────────────────────────────────────────────────────

function TableRenderer({ block }: { block: TableBlock }) {
  const [filter, setFilter] = useState('');
  const [copiedCell, setCopiedCell] = useState<string | null>(null);

  const filteredRows = useMemo(() => {
    if (!filter.trim()) return block.rows;
    const q = filter.toLowerCase();
    return block.rows.filter((row) =>
      row.some((cell) => String(cell).toLowerCase().includes(q))
    );
  }, [block.rows, filter]);

  const handleCsvExport = () => {
    const header = block.columns.join(',');
    const body = block.rows
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([`${header}\n${body}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(block.title ?? 'tableau').replace(/\s+/g, '_')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCellCopy = (value: string | number) => {
    const text = String(value);
    navigator.clipboard.writeText(text).then(() => {
      setCopiedCell(text);
      setTimeout(() => setCopiedCell(null), 1200);
    });
  };

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <BlockTitle title={block.title} />
        <div className="flex-1" />
        {/* Filtre */}
        <div
          className="flex items-center gap-1.5 px-2 py-1 rounded-lg"
          style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-base)' }}
        >
          <Search size={11} style={{ color: 'var(--text-dimmed)' }} />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filtrer…"
            className="bg-transparent outline-none w-24 text-sm"
            style={{ color: 'var(--text-primary)' }}
          />
          {filter && (
            <button onClick={() => setFilter('')} style={{ color: 'var(--text-dimmed)' }}>
              <X size={10} />
            </button>
          )}
        </div>
        {/* Export CSV */}
        <button
          onClick={handleCsvExport}
          className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-white/10 transition-colors"
          title="Exporter en CSV"
          style={{ color: 'var(--text-muted)', border: '1px solid var(--border-base)' }}
        >
          <FileDown size={12} />
          <span className="text-xs font-medium">CSV</span>
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl" style={{ border: '1px solid var(--border-base)' }}>
        <table className="w-full text-xs">
          <thead>
            <tr style={{ backgroundColor: 'var(--bg-tertiary)' }}>
              {block.columns.map((col, i) => (
                <th
                  key={i}
                  className="px-4 py-2.5 text-left font-semibold tracking-wide uppercase"
                  style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border-base)' }}
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr>
                <td
                  colSpan={block.columns.length}
                  className="px-4 py-5 text-center text-sm"
                  style={{ color: 'var(--text-dimmed)' }}
                >
                  Aucun résultat pour « {filter} »
                </td>
              </tr>
            ) : (
              filteredRows.map((row, ri) => (
                <tr
                  key={ri}
                  className="transition-colors"
                  style={{
                    backgroundColor: ri % 2 === 0 ? 'transparent' : 'var(--bg-secondary)',
                  }}
                >
                  {row.map((cell, ci) => (
                    <td
                      key={ci}
                      className="px-4 py-2.5 cursor-pointer select-none"
                      onClick={() => handleCellCopy(cell)}
                      title="Cliquer pour copier"
                      style={{
                        color: copiedCell === String(cell) ? 'var(--color-success)' : 'var(--text-primary)',
                        borderBottom:
                          ri < filteredRows.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                        transition: 'color 0.2s',
                      }}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {filter && (
        <p className="text-xs mt-1.5" style={{ color: 'var(--text-dimmed)' }}>
          {filteredRows.length} / {block.rows.length} ligne
          {block.rows.length > 1 ? 's' : ''}
        </p>
      )}
    </div>
  );
}

// ─── BarChartRenderer ─────────────────────────────────────────────────────────

function BarChartRenderer({ block }: { block: BarChartBlock }) {
  const [size, setSize] = useState<'sm' | 'md' | 'lg'>(block.height ?? 'md');
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <BlockTitle title={block.title} />
        <div className="flex-1" />
        <ChartSizePicker value={size} onChange={setSize} />
      </div>
      <ResponsiveContainer width="100%" height={CHART_HEIGHTS[size]}>
        <BarChart data={block.data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: 'var(--text-dimmed)' }}
            axisLine={false}
            tickLine={false}
            label={
              block.xLabel
                ? { value: block.xLabel, position: 'insideBottom', offset: -4, fontSize: 10, fill: 'var(--text-dimmed)' }
                : undefined
            }
          />
          <YAxis
            tick={{ fontSize: 11, fill: 'var(--text-dimmed)' }}
            axisLine={false}
            tickLine={false}
            label={
              block.yLabel
                ? { value: block.yLabel, angle: -90, position: 'insideLeft', fontSize: 10, fill: 'var(--text-dimmed)' }
                : undefined
            }
          />
          <Tooltip content={<CustomTooltip />} />
          {block.series.length > 1 && (
            <Legend wrapperStyle={{ fontSize: 11, color: 'var(--text-muted)' }} />
          )}
          {block.series.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label ?? s.key}
              fill={getColor(i, s.color)}
              radius={[4, 4, 0, 0]}
              stackId={block.stacked ? 'stack' : undefined}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── LineChartRenderer ────────────────────────────────────────────────────────

function LineChartRenderer({ block }: { block: LineChartBlock }) {
  const [size, setSize] = useState<'sm' | 'md' | 'lg'>(block.height ?? 'md');
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <BlockTitle title={block.title} />
        <div className="flex-1" />
        <ChartSizePicker value={size} onChange={setSize} />
      </div>
      <ResponsiveContainer width="100%" height={CHART_HEIGHTS[size]}>
        <LineChart data={block.data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: 'var(--text-dimmed)' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: 'var(--text-dimmed)' }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CustomTooltip />} />
          {block.series.length > 1 && (
            <Legend wrapperStyle={{ fontSize: 11, color: 'var(--text-muted)' }} />
          )}
          {block.series.map((s, i) => (
            <Line
              key={s.key}
              type={block.smooth ? 'monotone' : 'linear'}
              dataKey={s.key}
              name={s.label ?? s.key}
              stroke={getColor(i, s.color)}
              strokeWidth={2}
              dot={{ r: 3, strokeWidth: 0 }}
              activeDot={{ r: 5 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── AreaChartRenderer ────────────────────────────────────────────────────────

function AreaChartRenderer({ block }: { block: AreaChartBlock }) {
  const [size, setSize] = useState<'sm' | 'md' | 'lg'>(block.height ?? 'md');
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <BlockTitle title={block.title} />
        <div className="flex-1" />
        <ChartSizePicker value={size} onChange={setSize} />
      </div>
      <ResponsiveContainer width="100%" height={CHART_HEIGHTS[size]}>
        <AreaChart data={block.data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
          <defs>
            {block.series.map((s, i) => (
              <linearGradient key={s.key} id={`area-grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={getColor(i, s.color)} stopOpacity={0.3} />
                <stop offset="95%" stopColor={getColor(i, s.color)} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: 'var(--text-dimmed)' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: 'var(--text-dimmed)' }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CustomTooltip />} />
          {block.series.length > 1 && (
            <Legend wrapperStyle={{ fontSize: 11, color: 'var(--text-muted)' }} />
          )}
          {block.series.map((s, i) => (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label ?? s.key}
              stroke={getColor(i, s.color)}
              strokeWidth={2}
              fill={`url(#area-grad-${s.key})`}
              stackId={block.stacked ? 'stack' : undefined}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── PieChartRenderer ─────────────────────────────────────────────────────────

function PieChartRenderer({ block }: { block: PieChartBlock }) {
  const [size, setSize] = useState<'sm' | 'md' | 'lg'>(block.height ?? 'md');
  const total = useMemo(() => block.data.reduce((s, d) => s + d.value, 0), [block.data]);
  const RADIAN = Math.PI / 180;

  const renderLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }: any) => {
    if (percent < 0.05) return null;
    const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);
    return (
      <text
        x={x}
        y={y}
        fill="white"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={10}
        fontWeight={600}
      >
        {`${(percent * 100).toFixed(0)}%`}
      </text>
    );
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <BlockTitle title={block.title} />
        <div className="flex-1" />
        <ChartSizePicker value={size} onChange={setSize} />
      </div>
      <div className="flex items-center gap-4">
        <ResponsiveContainer width="55%" height={CHART_HEIGHTS[size]}>
          <PieChart>
            <Pie
              data={block.data}
              dataKey="value"
              nameKey="label"
              cx="50%"
              cy="50%"
              innerRadius={block.donut ? '40%' : 0}
              outerRadius="80%"
              labelLine={false}
              label={renderLabel}
            >
              {block.data.map((entry, i) => (
                <Cell key={i} fill={getColor(i, entry.color)} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
          </PieChart>
        </ResponsiveContainer>

        {/* Légende enrichie : valeur absolue + % */}
        <div className="flex flex-col gap-2 text-xs flex-1 min-w-0">
          {block.data.map((entry, i) => {
            const pct = total > 0 ? ((entry.value / total) * 100).toFixed(1) : '0';
            return (
              <div key={i} className="flex items-center gap-2 min-w-0">
                <span
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: getColor(i, entry.color) }}
                />
                <span className="truncate flex-1" style={{ color: 'var(--text-muted)' }}>
                  {entry.label}
                </span>
                <div className="flex flex-col items-end flex-shrink-0">
                  <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {entry.value.toLocaleString('fr-FR')}
                  </span>
                  <span className="text-xs" style={{ color: 'var(--text-dimmed)' }}>
                    {pct}%
                  </span>
                </div>
              </div>
            );
          })}
          <div
            className="flex items-center gap-2 pt-1.5 mt-0.5"
            style={{ borderTop: '1px solid var(--border-subtle)' }}
          >
            <span
              className="flex-1 text-xs uppercase tracking-wide"
              style={{ color: 'var(--text-dimmed)' }}
            >
              Total
            </span>
            <span className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>
              {total.toLocaleString('fr-FR')}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── CardRenderer ─────────────────────────────────────────────────────────────

function CardRenderer({ block }: { block: CardBlock }) {
  return (
    <div
      className="rounded-xl p-4"
      style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-base)' }}
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          {block.title && (
            <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              {block.title}
            </p>
          )}
          {block.subtitle && (
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-dimmed)' }}>
              {block.subtitle}
            </p>
          )}
        </div>
        {block.badge && (
          <span
            className="text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0"
            style={{
              backgroundColor: block.badge.color ? `${block.badge.color}22` : 'var(--bg-tertiary)',
              color: block.badge.color ?? 'var(--accent-primary)',
              border: `1px solid ${block.badge.color ? `${block.badge.color}44` : 'var(--border-base)'}`,
            }}
          >
            {block.badge.text}
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {block.fields.map((field, i) => (
          <div
            key={i}
            className="rounded-lg px-3 py-2"
            style={{
              backgroundColor: field.highlight ? 'rgba(99,102,241,0.12)' : 'var(--bg-panel)',
              border: `1px solid ${field.highlight ? 'rgba(99,102,241,0.3)' : 'var(--border-subtle)'}`,
            }}
          >
            <p
              className="text-xs uppercase tracking-wide mb-0.5"
              style={{ color: 'var(--text-dimmed)' }}
            >
              {field.label}
            </p>
            <p
              className="text-sm font-semibold truncate"
              style={{ color: field.highlight ? 'var(--accent-primary)' : 'var(--text-primary)' }}
            >
              {field.value}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── ListRenderer ─────────────────────────────────────────────────────────────

function ListRenderer({ block }: { block: ListBlock }) {
  return (
    <div>
      <div className="mb-3">
        <BlockTitle title={block.title} />
      </div>
      <div className="space-y-1.5">
        {block.items.map((item, i) => (
          <div
            key={i}
            className="flex items-start gap-3 px-3 py-2 rounded-lg"
            style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}
          >
            <span
              className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold mt-0.5"
              style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--accent-primary)' }}
            >
              {block.ordered ? i + 1 : (item.icon ?? '•')}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                {item.text}
              </p>
              {item.sub && (
                <p className="text-sm mt-0.5" style={{ color: 'var(--text-dimmed)' }}>
                  {item.sub}
                </p>
              )}
            </div>
            {item.badge && (
              <span
                className="text-xs px-1.5 py-0.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}
              >
                {item.badge}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── TextRenderer (Markdown) ──────────────────────────────────────────────────

function TextRenderer({ block }: { block: TextBlock }) {
  const { copied, copy } = useCopy(block.content);
  const useMarkdown = block.markdown !== false;

  const html = useMemo(() => {
    if (!useMarkdown) return null;
    try {
      const result = marked.parse(block.content, { gfm: true, breaks: true });
      return typeof result === 'string' ? sanitizeMarkdownHtml(result) : null;
    } catch {
      return null;
    }
  }, [block.content, useMarkdown]);

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <BlockTitle title={block.title} />
        <div className="flex-1" />
        <button
          onClick={copy}
          className="p-1 rounded hover:bg-white/10 transition-colors"
          title={copied ? 'Copié !' : 'Copier'}
          style={{ color: copied ? 'var(--color-success)' : 'var(--text-dimmed)' }}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
        </button>
      </div>
      {html ? (
        <div
          className="rich-text-markdown text-sm leading-relaxed"
          style={{ color: 'var(--text-muted)' }}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: HTML sanitized with sanitizeMarkdownHtml
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--text-muted)' }}>
          {block.content}
        </p>
      )}
    </div>
  );
}

// ─── CodeRenderer ─────────────────────────────────────────────────────────────

function CodeRenderer({ block }: { block: CodeBlock }) {
  const { copied, copy } = useCopy(block.content);
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <BlockTitle title={block.title} />
        <div className="flex-1" />
        {block.language && (
          <span
            className="text-xs font-mono px-2 py-0.5 rounded-full"
            style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--accent-primary)' }}
          >
            {block.language}
          </span>
        )}
        <button
          onClick={copy}
          className="p-1 rounded hover:bg-white/10 transition-colors"
          title={copied ? 'Copié !' : 'Copier le code'}
          style={{ color: copied ? 'var(--color-success)' : 'var(--text-dimmed)' }}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
        </button>
      </div>
      <div
        className="rounded-xl overflow-hidden"
        style={{ border: '1px solid var(--border-base)', backgroundColor: 'rgba(0,0,0,0.28)' }}
      >
        <pre
          className="p-4 text-sm font-mono overflow-x-auto custom-scrollbar"
          style={{ color: 'var(--text-primary)', lineHeight: 1.65, margin: 0 }}
        >
          <code>{block.content}</code>
        </pre>
      </div>
    </div>
  );
}

// ─── ProgressRenderer ────────────────────────────────────────────────────────

function ProgressRenderer({ block }: { block: ProgressBlock }) {
  return (
    <div>
      <div className="mb-3">
        <BlockTitle title={block.title} />
      </div>
      <div className="space-y-3.5">
        {block.items.map((item, i) => {
          const max = item.max ?? 100;
          const pct = Math.min(100, Math.max(0, (item.value / max) * 100));
          const color = item.color ?? getColor(i);
          return (
            <div key={i}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                  {item.label}
                </span>
                <span className="text-xs font-semibold tabular-nums" style={{ color }}>
                  {item.value.toLocaleString('fr-FR')}
                  {item.unit ? ` ${item.unit}` : ''}
                  {item.max !== undefined && (
                    <span className="font-normal text-xs ml-1" style={{ color: 'var(--text-dimmed)' }}>
                      / {item.max.toLocaleString('fr-FR')}
                      {item.unit ? ` ${item.unit}` : ''}
                    </span>
                  )}
                  <span className="font-normal text-xs ml-1.5" style={{ color: 'var(--text-dimmed)' }}>
                    ({pct.toFixed(0)}%)
                  </span>
                </span>
              </div>
              <div
                className="relative h-2 rounded-full overflow-hidden"
                style={{ backgroundColor: 'var(--bg-tertiary)' }}
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: color,
                    transition: 'width 0.6s cubic-bezier(0.4,0,0.2,1)',
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── TimelineRenderer ────────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  done:     'var(--color-success)',
  current:  'var(--accent-primary)',
  upcoming: 'var(--border-base)',
  error:    'var(--color-error)',
};

function TimelineRenderer({ block }: { block: TimelineBlock }) {
  return (
    <div>
      <div className="mb-3">
        <BlockTitle title={block.title} />
      </div>
      <div className="space-y-0">
        {block.events.map((event, i) => {
          const status = event.status ?? 'upcoming';
          const color = STATUS_COLOR[status] ?? 'var(--border-base)';
          const isLast = i === block.events.length - 1;
          const isCurrent = status === 'current';
          const isDone = status === 'done';

          return (
            <div key={i} className="flex gap-3">
              {/* Connector col */}
              <div className="flex flex-col items-center w-4 flex-shrink-0 pt-1">
                <div
                  className="w-3 h-3 rounded-full relative z-10 flex-shrink-0"
                  style={{
                    backgroundColor: isDone || isCurrent ? color : 'var(--bg-panel)',
                    border: `2px solid ${color}`,
                    boxShadow: isCurrent ? `0 0 0 3px ${color}33` : 'none',
                  }}
                />
                {!isLast && (
                  <div
                    className="w-px flex-1 mt-0.5"
                    style={{
                      backgroundColor: isDone ? color : 'var(--border-base)',
                      opacity: isDone ? 0.5 : 0.3,
                      minHeight: '20px',
                    }}
                  />
                )}
              </div>

              {/* Content */}
              <div className="flex-1 pb-4">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {event.title}
                  </span>
                  {event.badge && (
                    <span
                      className="text-xs font-semibold px-1.5 py-px rounded-full"
                      style={{
                        backgroundColor: `${color}22`,
                        color,
                        border: `1px solid ${color}44`,
                      }}
                    >
                      {event.badge}
                    </span>
                  )}
                  <span
                    className="ml-auto text-xs tabular-nums flex-shrink-0"
                    style={{ color: 'var(--text-dimmed)' }}
                  >
                    {event.date}
                  </span>
                </div>
                {event.description && (
                  <p className="text-sm mt-0.5 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                    {event.description}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── StatGridRenderer ────────────────────────────────────────────────────────

function StatGridRenderer({ block }: { block: StatGridBlock }) {
  const cols = block.columns ?? 3;
  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
    gap: '12px',
  };

  return (
    <div>
      <div className="mb-3">
        <BlockTitle title={block.title} />
      </div>
      <div style={gridStyle}>
        {block.items.map((item, i) => {
          const color = item.color ?? getColor(i);
          const changeUp = (item.change ?? 0) > 0;
          const changeDown = (item.change ?? 0) < 0;
          const changeColor = changeUp ? 'var(--color-success)' : changeDown ? 'var(--color-error)' : 'var(--text-dimmed)';

          return (
            <div
              key={i}
              className="rounded-xl p-3"
              style={{
                backgroundColor: 'var(--bg-secondary)',
                border: '1px solid var(--border-base)',
              }}
            >
              <p
                className="text-xs uppercase tracking-wide mb-2"
                style={{ color: 'var(--text-dimmed)' }}
              >
                {item.icon ? `${item.icon} ` : ''}{item.label}
              </p>
              <p className="text-xl font-bold leading-none truncate" style={{ color }}>
                {typeof item.value === 'number'
                  ? item.value.toLocaleString('fr-FR')
                  : item.value}
                {item.unit && (
                  <span className="text-xs font-normal ml-1" style={{ color: 'var(--text-dimmed)' }}>
                    {item.unit}
                  </span>
                )}
              </p>
              {item.change !== undefined && (
                <div className="flex items-center gap-1 mt-1.5">
                  {changeUp ? (
                    <ArrowUpRight size={11} style={{ color: changeColor, flexShrink: 0 }} />
                  ) : changeDown ? (
                    <ArrowDownRight size={11} style={{ color: changeColor, flexShrink: 0 }} />
                  ) : (
                    <Minus size={11} style={{ color: changeColor, flexShrink: 0 }} />
                  )}
                  <span className="text-sm font-medium" style={{ color: changeColor }}>
                    {changeUp ? '+' : ''}{item.change}%
                  </span>
                  {item.changeLabel && (
                    <span className="text-xs" style={{ color: 'var(--text-dimmed)' }}>
                      {item.changeLabel}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── BlockIcon & BlockLabel ───────────────────────────────────────────────────

function BlockIcon({ type }: { type: RichBlockType }) {
  const s = 12;
  const map: Record<RichBlockType, React.ReactNode> = {
    table:      <Table2 size={s} />,
    bar_chart:  <BarChart2 size={s} />,
    line_chart: <TrendingUp size={s} />,
    area_chart: <TrendingUp size={s} />,
    pie_chart:  <PieIcon size={s} />,
    card:       <FileText size={s} />,
    list:       <List size={s} />,
    text:       <FileText size={s} />,
    code:       <Code2 size={s} />,
    progress:   <Activity size={s} />,
    timeline:   <GitCommitVertical size={s} />,
    stat_grid:  <LayoutGrid size={s} />,
  };
  return <>{map[type]}</>;
}

function BlockLabel({ type }: { type: RichBlockType }) {
  const map: Record<RichBlockType, string> = {
    table:      'Tableau',
    bar_chart:  'Barres',
    line_chart: 'Courbe',
    area_chart: 'Aires',
    pie_chart:  'Camembert',
    card:       'Fiche',
    list:       'Liste',
    text:       'Texte',
    code:       'Code',
    progress:   'Progression',
    timeline:   'Chronologie',
    stat_grid:  'Statistiques',
  };
  return <>{map[type]}</>;
}

// ─── RichBlock (wrapper individuel) ──────────────────────────────────────────

function RichBlock({ block, index }: { block: RichBlock; index: number }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border-base)' }}
    >
      {/* En-tête */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-white/5 transition-colors"
        style={{ borderBottom: collapsed ? 'none' : '1px solid var(--border-subtle)' }}
      >
        <span
          className="flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full"
          style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--accent-primary)' }}
        >
          <BlockIcon type={block.type} />
          <BlockLabel type={block.type} />
        </span>
        <span className="flex-1 text-xs truncate" style={{ color: 'var(--text-muted)' }}>
          {('title' in block && block.title) ? block.title : `Bloc ${index + 1}`}
        </span>
        <span style={{ color: 'var(--text-dimmed)' }}>
          {collapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
        </span>
      </button>

      {/* Contenu */}
      {!collapsed && (
        <div className="p-4">
          {block.type === 'table'      && <TableRenderer    block={block} />}
          {block.type === 'bar_chart'  && <BarChartRenderer  block={block} />}
          {block.type === 'line_chart' && <LineChartRenderer block={block} />}
          {block.type === 'area_chart' && <AreaChartRenderer block={block} />}
          {block.type === 'pie_chart'  && <PieChartRenderer  block={block} />}
          {block.type === 'card'       && <CardRenderer      block={block} />}
          {block.type === 'list'       && <ListRenderer      block={block} />}
          {block.type === 'text'       && <TextRenderer      block={block} />}
          {block.type === 'code'       && <CodeRenderer      block={block} />}
          {block.type === 'progress'   && <ProgressRenderer  block={block} />}
          {block.type === 'timeline'   && <TimelineRenderer  block={block} />}
          {block.type === 'stat_grid'  && <StatGridRenderer  block={block} />}
        </div>
      )}
    </div>
  );
}

// ─── Composant principal ──────────────────────────────────────────────────────

interface Props {
  document: RichDocument;
  onClose?: () => void;
  /** Appelé avec le chemin souhaité — le parent gère l'envoi WebSocket */
  onSaveToWorkspace?: (path: string) => void;
}

// ─── Modale de sauvegarde workspace ──────────────────────────────────────────

type SaveStatus = 'idle' | 'saving' | 'success' | 'error';

function SaveModal({
  defaultPath,
  onConfirm,
  onCancel,
  status,
  error,
}: {
  defaultPath: string;
  onConfirm: (path: string) => void;
  onCancel: () => void;
  status: SaveStatus;
  error?: string;
}) {
  const [path, setPath] = useState(defaultPath);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && status === 'idle') onConfirm(path);
    if (e.key === 'Escape') onCancel();
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: 'var(--z-critical)' as any, backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        className="rounded-2xl p-5 w-[420px] shadow-2xl"
        style={{ backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border-base)' }}
      >
        {/* Header */}
        <div className="flex items-center gap-2.5 mb-4">
          <div
            className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)' }}
          >
            <Save size={14} style={{ color: 'var(--accent-primary)' }} />
          </div>
          <div>
            <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              Enregistrer dans le workspace
            </p>
            <p className="text-sm" style={{ color: 'var(--text-dimmed)' }}>
              Le fichier sera sauvegardé via le sandbox
            </p>
          </div>
          <button
            onClick={onCancel}
            className="ml-auto p-1 rounded-lg hover:bg-white/10 transition-colors"
            style={{ color: 'var(--text-dimmed)' }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Path input */}
        <div className="mb-3">
          <label className="text-sm font-medium block mb-1.5" style={{ color: 'var(--text-muted)' }}>
            Chemin du fichier (relatif au projet)
          </label>
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-xl"
            style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-base)' }}
          >
            <FolderOpen size={13} style={{ color: 'var(--text-dimmed)', flexShrink: 0 }} />
            <input
              ref={inputRef}
              value={path}
              onChange={(e) => setPath(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={status !== 'idle'}
              className="flex-1 bg-transparent outline-none text-sm font-mono"
              style={{ color: 'var(--text-primary)' }}
              placeholder="docs/rapport.rich.json"
              spellCheck={false}
            />
          </div>
          <p className="text-xs mt-1" style={{ color: 'var(--text-dimmed)' }}>
            Extension recommandée : <span className="font-mono" style={{ color: 'var(--accent-primary)' }}>.rich.json</span>
          </p>
        </div>

        {/* Status */}
        {status === 'success' && (
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-lg mb-3 text-sm"
            style={{ backgroundColor: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.3)', color: 'var(--color-success)' }}
          >
            <CheckCircle2 size={13} />
            <span>Fichier sauvegardé avec succès</span>
          </div>
        )}
        {status === 'error' && (
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-lg mb-3 text-sm"
            style={{ backgroundColor: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', color: 'var(--color-error)' }}
          >
            <AlertCircle size={13} />
            <span className="break-words">{error ?? 'Erreur de sauvegarde'}</span>
          </div>
        )}

        {/* Buttons */}
        <div className="flex items-center gap-2 justify-end">
          {status !== 'success' && (
            <button
              onClick={onCancel}
              disabled={status === 'saving'}
              className="px-3 py-1.5 rounded-lg text-xs transition-colors hover:bg-white/10"
              style={{ color: 'var(--text-muted)' }}
            >
              Annuler
            </button>
          )}
          {status === 'success' ? (
            <button
              onClick={onCancel}
              className="px-4 py-1.5 rounded-lg text-xs font-medium transition-colors"
              style={{ backgroundColor: 'rgba(52,211,153,0.2)', color: 'var(--color-success)', border: '1px solid rgba(52,211,153,0.3)' }}
            >
              Fermer
            </button>
          ) : (
            <button
              onClick={() => onConfirm(path)}
              disabled={status === 'saving' || !path.trim()}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium transition-colors"
              style={{
                backgroundColor: status === 'saving' ? 'rgba(99,102,241,0.3)' : 'var(--accent-primary)',
                color: 'white',
                opacity: !path.trim() ? 0.5 : 1,
              }}
            >
              {status === 'saving' ? (
                <><Loader2 size={11} className="animate-spin" /> Sauvegarde…</>
              ) : (
                <><Save size={11} /> Enregistrer</>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export const RichDocumentViewer = memo(function RichDocumentViewer({ document, onClose, onSaveToWorkspace }: Props) {
  const [allCollapsed, setAllCollapsed] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveError, setSaveError] = useState<string | undefined>();

  // Générer un chemin par défaut à partir du titre
  const defaultSavePath = useMemo(() => {
    const slug = document.title
      .toLowerCase()
      .replace(/[^a-z0-9\u00C0-\u024F]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'document';
    return `docs/${slug}.rich.json`;
  }, [document.title]);

  // Écouter le résultat de sauvegarde depuis le serveur
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.status === 'success') {
        setSaveStatus('success');
        setSaveError(undefined);
      } else if (detail?.status === 'error') {
        setSaveStatus('error');
        setSaveError(detail.error ?? 'Erreur inconnue');
      }
    };
    window.addEventListener('Leanna-save-rich-document-result', handler);
    return () => window.removeEventListener('Leanna-save-rich-document-result', handler);
  }, []);

  const handleOpenSaveModal = () => {
    setSaveStatus('idle');
    setSaveError(undefined);
    setShowSaveModal(true);
  };

  const handleConfirmSave = (path: string) => {
    if (!path.trim() || !onSaveToWorkspace) return;
    setSaveStatus('saving');
    onSaveToWorkspace(path.trim());
  };

  const handleCloseSaveModal = () => {
    if (saveStatus === 'saving') return;
    setShowSaveModal(false);
    setSaveStatus('idle');
    setSaveError(undefined);
  };

  const handleExportJson = () => {
    const blob = new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = window.document.createElement('a');
    a.href = url;
    a.download = `${document.title.replace(/\s+/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ backgroundColor: 'var(--bg-base)' }}>
      {/* ── SaveModal ── */}
      {showSaveModal && (
        <SaveModal
          defaultPath={defaultSavePath}
          onConfirm={handleConfirmSave}
          onCancel={handleCloseSaveModal}
          status={saveStatus}
          error={saveError}
        />
      )}

      {/* ── Header ── */}
      <div
        className="flex items-center gap-3 px-5 py-3 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border-base)', backgroundColor: 'var(--bg-panel)' }}
      >
        <Layers size={14} style={{ color: 'var(--accent-primary)' }} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
            {document.title}
          </p>
          {document.subtitle && (
            <p className="text-sm truncate" style={{ color: 'var(--text-dimmed)' }}>
              {document.subtitle}
            </p>
          )}
        </div>
        {document.createdAt && (
          <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-dimmed)' }}>
            {new Date(document.createdAt).toLocaleString('fr-FR', {
              dateStyle: 'short',
              timeStyle: 'short',
            })}
          </span>
        )}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setAllCollapsed((c) => !c)}
            className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
            style={{ color: 'var(--text-muted)' }}
            title={allCollapsed ? 'Tout déplier' : 'Tout replier'}
          >
            {allCollapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
          </button>
          {/* Enregistrer dans le workspace */}
          {onSaveToWorkspace && (
            <button
              onClick={handleOpenSaveModal}
              className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
              style={{ color: 'var(--text-muted)' }}
              title="Enregistrer dans le workspace"
            >
              <Save size={13} />
            </button>
          )}
          {/* Export JSON local */}
          <button
            onClick={handleExportJson}
            className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
            style={{ color: 'var(--text-muted)' }}
            title="Télécharger en JSON"
          >
            <Download size={13} />
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
              style={{ color: 'var(--text-muted)' }}
              title="Fermer"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* ── Stats bar ── */}
      {document.blocks.length > 0 && (
        <div
          className="flex items-center gap-3 px-5 py-2 flex-shrink-0 overflow-x-auto"
          style={{
            borderBottom: '1px solid var(--border-subtle)',
            backgroundColor: 'var(--bg-secondary)',
          }}
        >
          <span className="text-xs" style={{ color: 'var(--text-dimmed)' }}>
            {document.blocks.length} bloc{document.blocks.length > 1 ? 's' : ''}
          </span>
          {Object.entries(
            document.blocks.reduce<Record<string, number>>((acc, b) => {
              acc[b.type] = (acc[b.type] ?? 0) + 1;
              return acc;
            }, {})
          ).map(([type, count]) => (
            <span
              key={type}
              className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}
            >
              <BlockIcon type={type as RichBlockType} />
              {count}× <BlockLabel type={type as RichBlockType} />
            </span>
          ))}
        </div>
      )}

      {/* ── Blocs ── */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
        {document.blocks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-2">
            <Layers size={28} style={{ color: 'var(--text-dimmed)', opacity: 0.5 }} />
            <p className="text-xs" style={{ color: 'var(--text-dimmed)' }}>
              Document vide
            </p>
          </div>
        ) : (
          document.blocks.map((block, i) => (
            <RichBlock key={i} block={block} index={i} />
          ))
        )}
      </div>
    </div>
  );
});
