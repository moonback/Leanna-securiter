/**
 * MarketplacePanel — Marketplace d'agents et de skills Leanna.
 *
 * S'affiche en SidePanel overlay depuis la droite — l'EmptyEditorState
 * reste visible en arrière-plan.
 *
 * Fonctionnalités :
 *  - Accueil       : stats globales, catégories, paquets en vedette
 *  - Catalogue     : recherche plein-texte, filtres type/catégorie/tri, pagination
 *  - Installés     : liste des paquets installés avec désinstallation
 *  - Détail        : 4 onglets (Aperçu, Contenu, Avis, Sécurité), notation en ligne
 *  - Publier       : formulaire avec validation sécurité live avant soumission
 *  - Import JSON   : glisser-déposer ou sélection d'un fichier .leanna.json
 *  - Export        : téléchargement JSON d'un paquet installé
 *  - Partage       : copie du lien de paquet dans le presse-papier
 *  - Raccourcis    : Ctrl+K pour focus recherche, Échap pour fermer détail
 */

import React, {
  useState, useCallback, useEffect, useSyncExternalStore,
  useRef, useMemo,
} from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Store, Search, Download, Star, ShieldCheck, ShieldAlert, ShieldOff,
  CheckCircle, Package, Bot, Zap, Layers, ArrowLeft, Upload, RefreshCw,
  ChevronLeft, ChevronRight, Tag, Clock, TrendingUp, Award, X, Globe,
  Code, Database, Lock, Wrench, BookOpen, Send, AlertTriangle, Check,
  Sparkles, LayoutGrid, Shield, FileJson, Flame, BadgeCheck,
  Heart, Share2, Filter,
} from 'lucide-react';
import { SidePanel } from '../ui/SidePanel.js';
import { useToast } from '../ui/Toast.js';
import {
  getMarketplaceState, subscribe, initMarketplaceStore,
  selectPackage, clearSelectedPackage, installPackage, uninstallPackage,
  ratePackage, publishPackage, validateSecurity, downloadPackage,
  setSearchQuery, setActiveType, setActiveCategory, setActiveSort, setPage,
  type MarketplacePackage, type MarketplaceCategory,
  type MarketplacePackageType, type SecurityTrustLevel,
} from '../../stores/marketplaceStore.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Constantes
// ═══════════════════════════════════════════════════════════════════════════════

const CATEGORY_LABELS: Record<MarketplaceCategory | '', string> = {
  '': 'Toutes', code: 'Code', devops: 'DevOps', web: 'Web', data: 'Data',
  writing: 'Rédaction', security: 'Sécurité', productivity: 'Productivité',
  ai: 'IA', other: 'Autre',
};

const CATEGORY_ICONS: Record<string, React.FC<any>> = {
  code: Code, devops: Zap, web: Globe, data: Database,
  writing: BookOpen, security: Lock, productivity: Wrench,
  ai: Sparkles, other: Package,
};

const TYPE_LABELS: Record<MarketplacePackageType | '', string> = {
  '': 'Tous', agent: 'Agents', skill: 'Skills', bundle: 'Bundles',
};

const SORT_LABELS: Record<string, string> = {
  popular: 'Populaires', recent: 'Récents',
  rating: 'Mieux notés', installs: 'Plus installés',
};

const TRUST_CONFIG: Record<SecurityTrustLevel, { label: string; color: string; Icon: React.FC<any> }> = {
  verified:   { label: 'Certifié Leanna', color: 'var(--color-success)', Icon: ShieldCheck },
  community:  { label: 'Communautaire',   color: '#3b82f6',              Icon: Shield },
  unreviewed: { label: 'Non vérifié',     color: 'var(--text-dimmed)',   Icon: ShieldOff },
  flagged:    { label: 'Signalé',         color: 'var(--color-error)',   Icon: ShieldAlert },
};

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

function fmt(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function timeAgo(iso: string): string {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (d === 0) return "Aujourd'hui";
  if (d === 1) return 'Hier';
  if (d < 30)  return `Il y a ${d}j`;
  if (d < 365) return `Il y a ${Math.floor(d / 30)}mois`;
  return `Il y a ${Math.floor(d / 365)}an`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Micro-composants
// ═══════════════════════════════════════════════════════════════════════════════

function Stars({ rating, size = 11, interactive = false, onRate }: {
  rating: number; size?: number; interactive?: boolean; onRate?: (r: number) => void;
}) {
  const [hovered, setHovered] = useState(0);
  return (
    <span className="flex items-center gap-0.5">
      {[1,2,3,4,5].map(s => {
        const filled = interactive ? (hovered || rating) >= s : rating >= s - 0.5;
        return (
          <Star key={s} size={size}
            fill={filled ? '#eab308' : 'transparent'}
            strokeWidth={filled ? 0 : 1.5}
            style={{ color: filled ? '#eab308' : 'var(--text-dimmed)',
              cursor: interactive ? 'pointer' : 'default' }}
            onMouseEnter={() => interactive && setHovered(s)}
            onMouseLeave={() => interactive && setHovered(0)}
            onClick={() => interactive && onRate?.(s)}
          />
        );
      })}
    </span>
  );
}

function TypeBadge({ type }: { type: MarketplacePackageType }) {
  const cfg: Record<MarketplacePackageType, { color: string; Icon: React.FC<any> }> = {
    agent:  { color: '#8b5cf6', Icon: Bot },
    skill:  { color: '#06b6d4', Icon: Zap },
    bundle: { color: '#f59e0b', Icon: Layers },
  };
  const { color, Icon } = cfg[type];
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold px-1.5 py-0.5 rounded-full"
      style={{ color, backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 25%, transparent)` }}>
      <Icon size={9} />{TYPE_LABELS[type]}
    </span>
  );
}

function TrustBadge({ level }: { level: SecurityTrustLevel }) {
  const { label, color, Icon } = TRUST_CONFIG[level];
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded"
      style={{ color, backgroundColor: `color-mix(in srgb, ${color} 10%, transparent)` }}>
      <Icon size={10} />{label}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PackageCard — carte compacte (mode liste dans le SidePanel)
// ═══════════════════════════════════════════════════════════════════════════════

function PackageCard({ pkg, onSelect, onInstall, onUninstall, installing }: {
  pkg: MarketplacePackage;
  onSelect: (p: MarketplacePackage) => void;
  onInstall: (id: string) => void;
  onUninstall: (id: string) => void;
  installing: boolean;
}) {
  const installed = !!pkg._installed;
  return (
    <motion.div
      layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
      className="rounded-xl overflow-hidden cursor-pointer group"
      style={{ backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border-base)',
        transition: 'border-color .18s, box-shadow .18s' }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLDivElement).style.borderColor = pkg.color;
        (e.currentTarget as HTMLDivElement).style.boxShadow =
          `0 2px 12px color-mix(in srgb, ${pkg.color} 18%, transparent)`;
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border-base)';
        (e.currentTarget as HTMLDivElement).style.boxShadow = 'none';
      }}
      onClick={() => onSelect(pkg)}
    >
      {/* Barre colorée */}
      <div className="h-1 w-full"
        style={{ background: `linear-gradient(90deg, ${pkg.color}, color-mix(in srgb, ${pkg.color} 40%, transparent))` }} />

      <div className="p-3 flex items-start gap-2.5">
        {/* Avatar */}
        <div className="w-9 h-9 rounded-lg flex items-center justify-center text-lg flex-shrink-0"
          style={{ backgroundColor: `color-mix(in srgb, ${pkg.color} 12%, var(--bg-surface))` }}>
          {pkg.avatar}
        </div>

        <div className="flex-1 min-w-0">
          {/* Titre + badges */}
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
              {pkg.name}
            </span>
            {pkg.verified && <BadgeCheck size={11} style={{ color: 'var(--color-success)', flexShrink: 0 }} />}
            {pkg.featured && <Flame size={11} style={{ color: '#f59e0b', flexShrink: 0 }} />}
          </div>

          {/* Auteur + version + type */}
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="text-xs" style={{ color: 'var(--text-dimmed)' }}>
              {pkg.author} · v{pkg.version}
            </span>
            <TypeBadge type={pkg.type} />
          </div>

          {/* Description */}
          <p className="text-xs leading-relaxed line-clamp-2 mb-2"
            style={{ color: 'var(--text-muted)' }}>
            {pkg.description}
          </p>

          {/* Stats + bouton */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5 text-xs" style={{ color: 'var(--text-dimmed)' }}>
              <span className="flex items-center gap-1">
                <Download size={9} />{fmt(pkg.stats.downloads)}
              </span>
              <span className="flex items-center gap-1">
                <Star size={9} fill="#eab308" style={{ color: '#eab308' }} />
                {pkg.stats.rating.toFixed(1)}
              </span>
              <TrustBadge level={pkg.security.trustLevel} />
            </div>

            <button
              onClick={e => { e.stopPropagation(); installed ? onUninstall(pkg.id) : onInstall(pkg.id); }}
              disabled={installing || pkg.security.trustLevel === 'flagged'}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all
                hover:scale-105 disabled:opacity-40 disabled:hover:scale-100"
              style={installed
                ? { backgroundColor: 'var(--bg-surface)', color: 'var(--text-muted)', border: '1px solid var(--border-base)' }
                : { backgroundColor: pkg.color, color: 'white',
                    boxShadow: `0 2px 6px color-mix(in srgb, ${pkg.color} 30%, transparent)` }}
            >
              {installing
                ? <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                : installed ? <><Check size={9} /> Installé</> : <><Download size={9} /> Installer</>}
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PackageDetail — vue détail complète (4 onglets)
// ═══════════════════════════════════════════════════════════════════════════════

function PackageDetail({ pkg, onBack, onInstall, onUninstall, installing, onDownload, onShare }: {
  pkg: MarketplacePackage;
  onBack: () => void;
  onInstall: (id: string) => void;
  onUninstall: (id: string) => void;
  installing: boolean;
  onDownload: (id: string) => void;
  onShare: (id: string) => void;
}) {
  type Tab = 'overview' | 'content' | 'reviews' | 'security';
  const [tab, setTab] = useState<Tab>('overview');
  const [reviewText, setReviewText] = useState('');
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewAuthor, setReviewAuthor] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();
  const installed = !!pkg._installed;

  // Échap → retour liste
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onBack(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onBack]);

  const submitReview = async () => {
    if (!reviewText.trim() || !reviewAuthor.trim()) return;
    setSubmitting(true);
    const ok = await ratePackage(pkg.id, reviewRating, reviewText, reviewAuthor);
    setSubmitting(false);
    if (ok) { toast.success('Avis publié !'); setReviewText(''); setReviewAuthor(''); }
    else toast.error("Erreur d'envoi");
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Aperçu' },
    { id: 'content',  label: pkg.type === 'bundle' ? 'Contenu' : pkg.type === 'agent' ? 'Agent' : 'Skill' },
    { id: 'reviews',  label: `Avis (${pkg.stats.reviewCount})` },
    { id: 'security', label: 'Sécurité' },
  ];

  const trustCfg = TRUST_CONFIG[pkg.security.trustLevel];

  return (
    <div className="flex flex-col h-full">
      {/* ── Entête ── */}
      <div className="flex items-center gap-2 px-4 py-3 border-b flex-shrink-0"
        style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-panel)' }}>
        <button onClick={onBack}
          className="p-1.5 rounded-lg hover:bg-white/8 transition-colors flex-shrink-0"
          style={{ color: 'var(--text-muted)' }}>
          <ArrowLeft size={15} />
        </button>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center text-lg flex-shrink-0"
          style={{ backgroundColor: `color-mix(in srgb, ${pkg.color} 15%, var(--bg-surface))` }}>
          {pkg.avatar}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
              {pkg.name}
            </span>
            {pkg.verified && <BadgeCheck size={12} style={{ color: 'var(--color-success)' }} />}
            <TypeBadge type={pkg.type} />
          </div>
          <div className="text-xs" style={{ color: 'var(--text-dimmed)' }}>
            par {pkg.author} · v{pkg.version} · {pkg.license}
          </div>
        </div>
        {/* Actions rapides */}
        <div className="flex items-center gap-1">
          <button onClick={() => onShare(pkg.id)} title="Copier le lien"
            className="p-1.5 rounded-lg hover:bg-white/8" style={{ color: 'var(--text-dimmed)' }}>
            <Share2 size={13} />
          </button>
          <button onClick={() => onDownload(pkg.id)} title="Télécharger JSON"
            className="p-1.5 rounded-lg hover:bg-white/8" style={{ color: 'var(--text-dimmed)' }}>
            <Download size={13} />
          </button>
          <button
            onClick={() => installed ? onUninstall(pkg.id) : onInstall(pkg.id)}
            disabled={installing || pkg.security.trustLevel === 'flagged'}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold
              transition-all hover:scale-105 disabled:opacity-40"
            style={installed
              ? { backgroundColor: 'var(--bg-surface)', color: 'var(--text-muted)', border: '1px solid var(--border-base)' }
              : { backgroundColor: pkg.color, color: 'white',
                  boxShadow: `0 2px 10px color-mix(in srgb, ${pkg.color} 30%, transparent)` }}>
            {installing
              ? <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
              : installed ? <><Check size={11} /> Installé</> : <><Download size={11} /> Installer</>}
          </button>
        </div>
      </div>

      {/* ── Stats rapides ── */}
      <div className="flex items-center gap-4 px-4 py-2 border-b flex-shrink-0 text-xs"
        style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-surface)' }}>
        <span className="flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
          <Download size={10} style={{ color: 'var(--text-dimmed)' }} />{fmt(pkg.stats.downloads)}
        </span>
        <span className="flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
          <Package size={10} style={{ color: 'var(--text-dimmed)' }} />{fmt(pkg.stats.installs)} inst.
        </span>
        <span className="flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
          <TrendingUp size={10} style={{ color: 'var(--text-dimmed)' }} />{fmt(pkg.stats.weeklyDownloads)}/sem
        </span>
        <span className="flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
          <Clock size={10} style={{ color: 'var(--text-dimmed)' }} />{timeAgo(pkg.updatedAt)}
        </span>
        <span className="flex items-center gap-1.5 ml-auto">
          <Stars rating={pkg.stats.rating} size={10} />
          <span style={{ color: 'var(--text-muted)' }}>
            {pkg.stats.rating.toFixed(1)} ({pkg.stats.reviewCount})
          </span>
        </span>
      </div>

      {/* ── Tabs ── */}
      <div className="flex border-b flex-shrink-0" style={{ borderColor: 'var(--border-base)' }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className="flex-1 py-2.5 text-xs font-medium transition-colors"
            style={{ color: tab === t.id ? 'var(--accent-primary)' : 'var(--text-muted)',
              borderBottom: tab === t.id ? '2px solid var(--accent-primary)' : '2px solid transparent' }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Contenu des onglets ── */}
      <div className="flex-1 overflow-y-auto">
        <AnimatePresence mode="wait">

          {/* APERÇU */}
          {tab === 'overview' && (
            <motion.div key="ov" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="p-4 space-y-4">
              <p className="text-sm leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                {pkg.description}
              </p>
              {pkg.readme && (
                <div className="p-3 rounded-xl text-xs leading-relaxed font-mono whitespace-pre-wrap"
                  style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-base)',
                    color: 'var(--text-muted)' }}>
                  {pkg.readme}
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                {[
                  ['Auteur',    pkg.author],
                  ['Version',   pkg.version],
                  ['Licence',   pkg.license],
                  ['Catégorie', CATEGORY_LABELS[pkg.category as MarketplaceCategory] ?? pkg.category],
                  ['Publié',    timeAgo(pkg.publishedAt)],
                  ['Versions',  pkg.versions.join(', ')],
                ].map(([k, v]) => (
                  <div key={k} className="p-2.5 rounded-lg"
                    style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-base)' }}>
                    <div className="text-xs mb-0.5" style={{ color: 'var(--text-dimmed)' }}>{k}</div>
                    <div className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{v}</div>
                  </div>
                ))}
              </div>
              {pkg.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {pkg.tags.map(tag => (
                    <span key={tag} className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-muted)',
                        border: '1px solid var(--border-base)' }}>
                      <Tag size={9} />{tag}
                    </span>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {/* CONTENU */}
          {tab === 'content' && (
            <motion.div key="ct" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="p-4 space-y-3">
              {pkg.agent && (
                <div className="rounded-xl overflow-hidden"
                  style={{ border: '1px solid color-mix(in srgb, #8b5cf6 30%, var(--border-base))' }}>
                  <div className="flex items-center gap-2 px-3 py-2.5"
                    style={{ backgroundColor: 'color-mix(in srgb, #8b5cf6 8%, var(--bg-surface))',
                      borderBottom: '1px solid var(--border-base)' }}>
                    <Bot size={13} style={{ color: '#8b5cf6' }} />
                    <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#8b5cf6' }}>
                      Agent inclus
                    </span>
                  </div>
                  <div className="p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                        {pkg.agent.name}
                      </span>
                      <code className="text-xs px-1.5 py-0.5 rounded font-mono"
                        style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-dimmed)' }}>
                        {pkg.agent.role}
                      </code>
                    </div>
                    {pkg.agent.description && (
                      <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                        {pkg.agent.description}
                      </p>
                    )}
                    {(pkg.agent.capabilities?.length ?? 0) > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {pkg.agent.capabilities.map((c: string) => (
                          <code key={c} className="text-xs px-1.5 py-0.5 rounded font-mono"
                            style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-muted)',
                              border: '1px solid var(--border-base)' }}>{c}</code>
                        ))}
                      </div>
                    )}
                    {(pkg.agent.triggerKeywords?.length ?? 0) > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {(pkg.agent.triggerKeywords ?? []).map((kw: string) => (
                          <span key={kw} className="text-xs px-2 py-0.5 rounded"
                            style={{ backgroundColor: 'color-mix(in srgb, #8b5cf6 10%, transparent)',
                              color: '#8b5cf6' }}>#{kw}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
              {(pkg.skills ?? []).length > 0 && (pkg.skills!).map(skill => (
                <div key={skill.name} className="rounded-xl overflow-hidden"
                  style={{ border: '1px solid color-mix(in srgb, #06b6d4 30%, var(--border-base))' }}>
                  <div className="flex items-center gap-2 px-3 py-2"
                    style={{ backgroundColor: 'color-mix(in srgb, #06b6d4 8%, var(--bg-surface))',
                      borderBottom: '1px solid var(--border-base)' }}>
                    <Zap size={12} style={{ color: '#06b6d4' }} />
                    <code className="text-xs font-mono font-semibold" style={{ color: '#06b6d4' }}>
                      {skill.name}
                    </code>
                  </div>
                  <div className="p-3 space-y-1.5">
                    {skill.description && (
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{skill.description}</p>
                    )}
                    {(skill.parameters ?? []).map((p: any, i: number) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <code className="px-1.5 py-0.5 rounded font-mono"
                          style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)' }}>
                          {p.name}
                        </code>
                        <span style={{ color: 'var(--text-dimmed)' }}>{p.type}</span>
                        {p.required && (
                          <span className="text-xs px-1 rounded"
                            style={{ backgroundColor: 'var(--color-error-subtle)', color: 'var(--color-error)' }}>
                            requis
                          </span>
                        )}
                        <span className="flex-1 truncate" style={{ color: 'var(--text-muted)' }}>
                          {p.description}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </motion.div>
          )}

          {/* AVIS */}
          {tab === 'reviews' && (
            <motion.div key="rv" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="p-4 space-y-3">
              {/* Formulaire */}
              <div className="p-3 rounded-xl space-y-2.5"
                style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-base)' }}>
                <div className="flex items-center gap-2">
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Note :</span>
                  <Stars rating={reviewRating} size={16} interactive onRate={setReviewRating} />
                </div>
                <input value={reviewAuthor} onChange={e => setReviewAuthor(e.target.value)}
                  placeholder="Ton pseudo"
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                  style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-base)',
                    color: 'var(--text-primary)' }} />
                <textarea value={reviewText} onChange={e => setReviewText(e.target.value)}
                  placeholder="Partage ton expérience..." rows={3}
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none resize-none"
                  style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-base)',
                    color: 'var(--text-primary)' }} />
                <button onClick={submitReview}
                  disabled={submitting || !reviewText.trim() || !reviewAuthor.trim()}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold
                    transition-all hover:scale-105 disabled:opacity-40"
                  style={{ backgroundColor: 'var(--accent-primary)', color: 'white' }}>
                  {submitting
                    ? <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    : <Send size={12} />}
                  Publier
                </button>
              </div>

              {/* Liste des avis */}
              {pkg.reviews.length === 0 ? (
                <p className="text-sm text-center py-6" style={{ color: 'var(--text-dimmed)' }}>
                  Aucun avis. Sois le premier !
                </p>
              ) : pkg.reviews.map(review => (
                <div key={review.id} className="p-3 rounded-xl"
                  style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-base)' }}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
                        style={{ backgroundColor: 'var(--accent-subtle)', color: 'var(--accent-primary)' }}>
                        {review.author[0]?.toUpperCase()}
                      </div>
                      <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                        {review.author}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Stars rating={review.rating} size={10} />
                      <span className="text-xs" style={{ color: 'var(--text-dimmed)' }}>
                        {timeAgo(review.createdAt)}
                      </span>
                    </div>
                  </div>
                  <p className="text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                    {review.comment}
                  </p>
                  {review.helpful > 0 && (
                    <div className="mt-1.5 flex items-center gap-1 text-xs"
                      style={{ color: 'var(--text-dimmed)' }}>
                      <Heart size={9} /> {review.helpful} utile
                    </div>
                  )}
                </div>
              ))}
            </motion.div>
          )}

          {/* SÉCURITÉ */}
          {tab === 'security' && (
            <motion.div key="sc" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="p-4 space-y-3">
              <div className="rounded-xl p-4"
                style={{ border: `2px solid ${trustCfg.color}`,
                  backgroundColor: `color-mix(in srgb, ${trustCfg.color} 5%, var(--bg-surface))` }}>
                <div className="flex items-center justify-between mb-2">
                  <TrustBadge level={pkg.security.trustLevel} />
                  <div className="text-right">
                    <div className="text-3xl font-bold" style={{ color: trustCfg.color }}>
                      {pkg.security.score}
                    </div>
                    <div className="text-xs" style={{ color: 'var(--text-dimmed)' }}>/100</div>
                  </div>
                </div>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{pkg.security.summary}</p>
                <p className="mt-1.5 text-xs" style={{ color: 'var(--text-dimmed)' }}>
                  Analysé {timeAgo(pkg.security.analyzedAt)}
                </p>
              </div>

              {pkg.security.warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-2 p-3 rounded-lg text-sm"
                  style={{ backgroundColor: 'var(--color-warning-subtle)',
                    border: '1px solid color-mix(in srgb, var(--color-warning) 25%, transparent)' }}>
                  <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--color-warning)' }} />
                  <span style={{ color: 'var(--text-primary)' }}>{w}</span>
                </div>
              ))}
              {pkg.security.flags.map((f, i) => (
                <div key={i} className="flex items-start gap-2 p-3 rounded-lg text-sm"
                  style={{ backgroundColor: 'var(--color-error-subtle)',
                    border: '1px solid color-mix(in srgb, var(--color-error) 25%, transparent)' }}>
                  <ShieldAlert size={13} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--color-error)' }} />
                  <span style={{ color: 'var(--text-primary)' }}>{f}</span>
                </div>
              ))}
              {pkg.security.warnings.length === 0 && pkg.security.flags.length === 0 && (
                <div className="flex items-center gap-3 p-3 rounded-xl"
                  style={{ backgroundColor: 'var(--color-success-subtle)',
                    border: '1px solid color-mix(in srgb, var(--color-success) 25%, transparent)' }}>
                  <ShieldCheck size={18} style={{ color: 'var(--color-success)' }} />
                  <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
                    Aucun problème détecté. Ce paquet est sûr.
                  </p>
                </div>
              )}
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PublishForm — formulaire de publication avec scan sécurité live
// ═══════════════════════════════════════════════════════════════════════════════

function PublishForm({ onDone }: { onDone: () => void }) {
  type Step = 'form' | 'security' | 'done';
  const [step, setStep] = useState<Step>('form');
  const [busy, setBusy] = useState(false);
  const [secReport, setSecReport] = useState<any>(null);
  const [published, setPublished] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();

  const [d, setD] = useState({
    name: '', description: '', type: 'agent' as MarketplacePackageType,
    category: 'code' as MarketplaceCategory, tags: '', version: '1.0.0',
    author: '', license: 'MIT', avatar: '🤖', color: '#6366f1',
    agentRole: '', agentName: '', agentDesc: '', agentPrompt: '',
    skillName: '', skillDesc: '', skillInstruction: '',
  });
  const u = (k: string, v: string) => setD(prev => ({ ...prev, [k]: v }));

  const buildPayload = () => ({
    name: d.name, description: d.description, type: d.type,
    category: d.category, tags: d.tags.split(',').map(t => t.trim()).filter(Boolean),
    version: d.version, author: d.author, license: d.license,
    avatar: d.avatar, color: d.color,
    ...(d.type !== 'skill' && d.agentRole ? {
      agent: { name: d.agentName || d.name, role: d.agentRole, description: d.agentDesc,
        systemPrompt: d.agentPrompt, capabilities: [], tools: [],
        maxConcurrency: 2, defaultTimeoutMs: 60000, triggerKeywords: [] },
    } : {}),
    ...(d.type !== 'agent' && d.skillName ? {
      skills: [{ name: d.skillName, description: d.skillDesc,
        parameters: [], instruction: d.skillInstruction, category: d.category, icon: 'Zap' }],
    } : {}),
  });

  const handleValidate = async () => {
    setBusy(true); setErr(null);
    const r = await validateSecurity(buildPayload());
    setBusy(false);
    if (r.securityReport) { setSecReport(r.securityReport); setStep('security'); }
    else setErr(r.error ?? 'Erreur');
  };

  const handlePublish = async () => {
    setBusy(true); setErr(null);
    const r = await publishPackage(buildPayload());
    setBusy(false);
    if (r.success) { setPublished(r.package); setStep('done'); toast.success(`"${r.package?.name}" publié !`); }
    else setErr(r.error ?? 'Erreur');
  };

  const inp = {
    className: 'w-full px-3 py-2 rounded-lg text-sm outline-none',
    style: { backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-base)',
      color: 'var(--text-primary)' },
  };

  if (step === 'done' && published) return (
    <div className="flex flex-col items-center justify-center h-full gap-4 p-6 text-center">
      <div className="text-4xl">{published.avatar}</div>
      <CheckCircle size={36} style={{ color: 'var(--color-success)' }} />
      <div>
        <h2 className="text-base font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
          Publié avec succès !
        </h2>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          "{published.name}" est disponible dans le Marketplace.
        </p>
      </div>
      <button onClick={onDone}
        className="px-5 py-2 rounded-lg text-sm font-semibold"
        style={{ backgroundColor: 'var(--accent-primary)', color: 'white' }}>
        Retour
      </button>
    </div>
  );

  if (step === 'security' && secReport) {
    const cfg = TRUST_CONFIG[secReport.trustLevel as SecurityTrustLevel];
    return (
      <div className="p-4 space-y-3 overflow-y-auto h-full">
        <button onClick={() => setStep('form')}
          className="flex items-center gap-1.5 text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
          <ArrowLeft size={13} /> Modifier
        </button>
        <div className="rounded-xl p-4"
          style={{ border: `2px solid ${cfg.color}`,
            backgroundColor: `color-mix(in srgb, ${cfg.color} 5%, var(--bg-surface))` }}>
          <div className="flex justify-between items-center mb-2">
            <TrustBadge level={secReport.trustLevel} />
            <span className="text-2xl font-bold" style={{ color: cfg.color }}>
              {secReport.score}<span className="text-sm font-normal">/100</span>
            </span>
          </div>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{secReport.summary}</p>
        </div>
        {secReport.warnings.map((w: string, i: number) => (
          <div key={i} className="flex items-start gap-2 p-3 rounded-lg text-sm"
            style={{ backgroundColor: 'var(--color-warning-subtle)',
              border: '1px solid color-mix(in srgb, var(--color-warning) 25%, transparent)' }}>
            <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--color-warning)' }} />
            <span>{w}</span>
          </div>
        ))}
        {err && <p className="text-sm p-3 rounded-lg"
          style={{ backgroundColor: 'var(--color-error-subtle)', color: 'var(--color-error)' }}>{err}</p>}
        {secReport.flags.length === 0 ? (
          <button onClick={handlePublish} disabled={busy}
            className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl font-semibold
              hover:scale-105 disabled:opacity-40 transition-all"
            style={{ backgroundColor: 'var(--accent-primary)', color: 'white' }}>
            {busy ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              : <Upload size={14} />}
            Publier dans le Marketplace
          </button>
        ) : (
          <div className="p-3 rounded-xl text-sm text-center"
            style={{ backgroundColor: 'var(--color-error-subtle)', color: 'var(--color-error)' }}>
            Publication bloquée — corrige les problèmes critiques.
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3 overflow-y-auto h-full">
      <div className="grid grid-cols-2 gap-2.5">
        <div className="col-span-2">
          <label className="text-xs mb-1 block" style={{ color: 'var(--text-dimmed)' }}>Nom *</label>
          <input value={d.name} onChange={e => u('name', e.target.value)} placeholder="Mon Super Agent" {...inp} />
        </div>
        <div className="col-span-2">
          <label className="text-xs mb-1 block" style={{ color: 'var(--text-dimmed)' }}>Description *</label>
          <textarea value={d.description} onChange={e => u('description', e.target.value)}
            placeholder="Une description courte..." rows={2}
            className="w-full px-3 py-2 rounded-lg text-sm outline-none resize-none"
            style={inp.style} />
        </div>
        {[
          { k: 'author', l: 'Auteur *', p: 'ton_pseudo' },
          { k: 'version', l: 'Version', p: '1.0.0' },
          { k: 'license', l: 'Licence', p: 'MIT' },
          { k: 'avatar', l: 'Emoji', p: '🤖' },
        ].map(({ k, l, p }) => (
          <div key={k}>
            <label className="text-xs mb-1 block" style={{ color: 'var(--text-dimmed)' }}>{l}</label>
            <input value={(d as any)[k]} onChange={e => u(k, e.target.value)} placeholder={p} {...inp} />
          </div>
        ))}
        <div>
          <label className="text-xs mb-1 block" style={{ color: 'var(--text-dimmed)' }}>Type</label>
          <select value={d.type} onChange={e => u('type', e.target.value)} {...inp}>
            <option value="agent">Agent</option>
            <option value="skill">Skill</option>
            <option value="bundle">Bundle</option>
          </select>
        </div>
        <div>
          <label className="text-xs mb-1 block" style={{ color: 'var(--text-dimmed)' }}>Catégorie</label>
          <select value={d.category} onChange={e => u('category', e.target.value)} {...inp}>
            {Object.entries(CATEGORY_LABELS).filter(([k]) => k !== '').map(([k, v]) => (
              <option key={k} value={k}>{v as string}</option>
            ))}
          </select>
        </div>
        <div className="col-span-2">
          <label className="text-xs mb-1 block" style={{ color: 'var(--text-dimmed)' }}>Tags (virgule)</label>
          <input value={d.tags} onChange={e => u('tags', e.target.value)}
            placeholder="typescript, api, automation" {...inp} />
        </div>
      </div>

      {/* Section agent */}
      {d.type !== 'skill' && (
        <div className="p-3 rounded-xl space-y-2"
          style={{ backgroundColor: 'color-mix(in srgb, #8b5cf6 5%, var(--bg-surface))',
            border: '1px solid color-mix(in srgb, #8b5cf6 20%, transparent)' }}>
          <div className="flex items-center gap-1.5 mb-1">
            <Bot size={12} style={{ color: '#8b5cf6' }} />
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#8b5cf6' }}>Agent</span>
          </div>
          {[
            { k: 'agentRole', l: 'Rôle (snake_case) *', p: 'mon_agent' },
            { k: 'agentName', l: 'Nom affiché', p: 'Mon Agent' },
            { k: 'agentDesc', l: 'Description', p: 'Cet agent...' },
          ].map(({ k, l, p }) => (
            <div key={k}>
              <label className="text-xs mb-1 block" style={{ color: 'var(--text-dimmed)' }}>{l}</label>
              <input value={(d as any)[k]} onChange={e => u(k, e.target.value)} placeholder={p} {...inp} />
            </div>
          ))}
          <div>
            <label className="text-xs mb-1 block" style={{ color: 'var(--text-dimmed)' }}>System Prompt</label>
            <textarea value={d.agentPrompt} onChange={e => u('agentPrompt', e.target.value)}
              placeholder="Tu es un expert en..." rows={4}
              className="w-full px-3 py-2 rounded-lg text-sm outline-none resize-none font-mono"
              style={inp.style} />
          </div>
        </div>
      )}

      {/* Section skill */}
      {d.type !== 'agent' && (
        <div className="p-3 rounded-xl space-y-2"
          style={{ backgroundColor: 'color-mix(in srgb, #06b6d4 5%, var(--bg-surface))',
            border: '1px solid color-mix(in srgb, #06b6d4 20%, transparent)' }}>
          <div className="flex items-center gap-1.5 mb-1">
            <Zap size={12} style={{ color: '#06b6d4' }} />
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#06b6d4' }}>Skill</span>
          </div>
          {[
            { k: 'skillName', l: 'Nom (snake_case) *', p: 'mon_skill' },
            { k: 'skillDesc', l: 'Description', p: 'Ce skill...' },
          ].map(({ k, l, p }) => (
            <div key={k}>
              <label className="text-xs mb-1 block" style={{ color: 'var(--text-dimmed)' }}>{l}</label>
              <input value={(d as any)[k]} onChange={e => u(k, e.target.value)} placeholder={p} {...inp} />
            </div>
          ))}
          <div>
            <label className="text-xs mb-1 block" style={{ color: 'var(--text-dimmed)' }}>Instruction *</label>
            <textarea value={d.skillInstruction} onChange={e => u('skillInstruction', e.target.value)}
              placeholder="Effectue les actions suivantes : {{param}}..." rows={4}
              className="w-full px-3 py-2 rounded-lg text-sm outline-none resize-none font-mono"
              style={inp.style} />
          </div>
        </div>
      )}

      {err && <p className="text-sm p-3 rounded-lg"
        style={{ backgroundColor: 'var(--color-error-subtle)', color: 'var(--color-error)' }}>{err}</p>}

      <button onClick={handleValidate}
        disabled={busy || !d.name.trim() || !d.description.trim() || !d.author.trim()}
        className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl font-semibold
          hover:scale-105 disabled:opacity-40 transition-all"
        style={{ backgroundColor: 'var(--accent-primary)', color: 'white' }}>
        {busy
          ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          : <Shield size={14} />}
        Analyser la sécurité
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ImportDropzone — import d'un fichier .leanna.json par glisser-déposer
// ═══════════════════════════════════════════════════════════════════════════════

function ImportDropzone({ onImported }: { onImported: () => void }) {
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ count?: number; error?: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  const processFile = async (file: File) => {
    setBusy(true); setResult(null);
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      // Peut être un tableau ou un seul paquet
      const list = Array.isArray(json) ? json : [json];
      // Installer chaque paquet via l'API
      let installed = 0;
      for (const pkg of list) {
        if (!pkg?.id) continue;
        const r = await installPackage(pkg.id);
        if (r.success) installed++;
      }
      setResult({ count: installed });
      if (installed > 0) { toast.success(`${installed} paquet(s) importé(s) !`); onImported(); }
      else setResult({ error: 'Aucun paquet valide trouvé dans le fichier.' });
    } catch (e: any) {
      setResult({ error: e.message });
    } finally { setBusy(false); }
  };

  return (
    <div
      className="relative rounded-xl border-2 border-dashed transition-all p-6 text-center cursor-pointer"
      style={{
        borderColor: dragging ? 'var(--accent-primary)' : 'var(--border-base)',
        backgroundColor: dragging ? 'color-mix(in srgb, var(--accent-primary) 5%, transparent)' : 'var(--bg-surface)',
      }}
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => {
        e.preventDefault(); setDragging(false);
        const f = e.dataTransfer.files[0];
        if (f) processFile(f);
      }}
      onClick={() => fileRef.current?.click()}
    >
      <input ref={fileRef} type="file" accept=".json,.leanna.json" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) processFile(f); }} />
      {busy ? (
        <div className="flex flex-col items-center gap-2">
          <span className="w-6 h-6 border-2 border-t-[var(--accent-primary)] border-[var(--border-base)] rounded-full animate-spin" />
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Import en cours...</span>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2">
          <FileJson size={28} style={{ color: dragging ? 'var(--accent-primary)' : 'var(--text-dimmed)' }} />
          <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            Glisser un fichier <code>.leanna.json</code>
          </p>
          <p className="text-xs" style={{ color: 'var(--text-dimmed)' }}>ou cliquer pour sélectionner</p>
        </div>
      )}
      {result && (
        <div className="mt-3 text-xs p-2 rounded-lg"
          style={result.error
            ? { backgroundColor: 'var(--color-error-subtle)', color: 'var(--color-error)' }
            : { backgroundColor: 'var(--color-success-subtle)', color: 'var(--color-success)' }}>
          {result.error ?? `✓ ${result.count} paquet(s) importé(s) avec succès`}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Composant principal — MarketplacePanel
// ═══════════════════════════════════════════════════════════════════════════════

type PanelView = 'home' | 'catalog' | 'installed' | 'publish' | 'import';

interface MarketplacePanelProps {
  onClose: () => void;
}

export function MarketplacePanel({ onClose }: MarketplacePanelProps) {
  const state = useSyncExternalStore(subscribe, getMarketplaceState);
  const [view, setView] = useState<PanelView>('home');
  const [initialized, setInitialized] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  useEffect(() => {
    if (!initialized) { initMarketplaceStore(); setInitialized(true); }
  }, [initialized]);

  // Raccourci Ctrl+K → focus recherche
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setView('catalog');
        setTimeout(() => searchRef.current?.focus(), 50);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // ── Handlers ──────────────────────────────────────────────────────────

  const handleSelect = useCallback((pkg: MarketplacePackage) => selectPackage(pkg.id), []);
  const handleBack   = useCallback(() => clearSelectedPackage(), []);

  const handleInstall = useCallback(async (id: string) => {
    const r = await installPackage(id);
    r.success ? toast.success(r.message ?? 'Paquet installé !') : toast.error(r.error ?? "Erreur d'installation");
  }, [toast]);

  const handleUninstall = useCallback(async (id: string) => {
    const r = await uninstallPackage(id);
    r.success ? toast.success('Paquet désinstallé.') : toast.error(r.error ?? 'Erreur');
  }, [toast]);

  const handleDownload = useCallback((id: string) => downloadPackage(id), []);

  const handleShare = useCallback((id: string) => {
    const url = `${window.location.origin}/marketplace/package/${id}`;
    navigator.clipboard.writeText(url).then(
      () => toast.success('Lien copié !'),
      () => toast.error('Impossible de copier le lien'),
    );
  }, [toast]);

  // ── Nav tabs ─────────────────────────────────────────────────────────

  const navTabs: Array<{ id: PanelView; label: string; icon: React.FC<any>; count?: number }> = useMemo(() => [
    { id: 'home',    label: 'Accueil',   icon: Store },
    { id: 'catalog', label: 'Catalogue', icon: LayoutGrid, count: state.total },
    { id: 'installed', label: 'Installés', icon: Check as any, count: state.installed.length },
    { id: 'import',  label: 'Importer',  icon: FileJson },
    { id: 'publish', label: 'Publier',   icon: Upload },
  ], [state.total, state.installed.length]);

  // ── Contenu ───────────────────────────────────────────────────────────

  const content = (
    <div className="flex flex-col h-full" style={{ backgroundColor: 'var(--bg-main)' }}>
      <AnimatePresence mode="wait">

        {/* ── VUE DÉTAIL ── */}
        {state.selectedPackage ? (
          <motion.div key="detail" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 12 }} className="flex flex-col h-full">
            <PackageDetail
              pkg={state.selectedPackage}
              onBack={handleBack}
              onInstall={handleInstall}
              onUninstall={handleUninstall}
              installing={state.installLoading[state.selectedPackage.id] ?? false}
              onDownload={handleDownload}
              onShare={handleShare}
            />
          </motion.div>
        ) : (

          <motion.div key="main" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            exit={{ opacity: 0 }} className="flex flex-col h-full">

            {/* ── Stats ── */}
            {state.stats && (
              <div className="grid grid-cols-4 gap-1.5 px-3 pt-3 pb-2 border-b flex-shrink-0"
                style={{ borderColor: 'var(--border-base)' }}>
                {[
                  { l: 'Total',    v: state.stats.total,     c: 'var(--accent-primary)' },
                  { l: 'Agents',   v: state.stats.agents,    c: '#8b5cf6' },
                  { l: 'Skills',   v: state.stats.skills,    c: '#06b6d4' },
                  { l: 'Installés',v: state.stats.installed, c: 'var(--color-success)' },
                ].map(({ l, v, c }) => (
                  <div key={l} className="rounded-lg py-1.5 text-center"
                    style={{ backgroundColor: `color-mix(in srgb, ${c} 8%, var(--bg-surface))`,
                      border: `1px solid color-mix(in srgb, ${c} 20%, transparent)` }}>
                    <div className="text-base font-bold leading-none" style={{ color: c }}>{v}</div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--text-dimmed)', fontSize: '10px' }}>{l}</div>
                  </div>
                ))}
              </div>
            )}

            {/* ── Tabs navigation ── */}
            <div className="flex border-b flex-shrink-0 overflow-x-auto"
              style={{ borderColor: 'var(--border-base)' }}>
              {navTabs.map(({ id, label, icon: Icon, count }) => (
                <button key={id} onClick={() => setView(id)}
                  className="flex items-center gap-1 px-3 py-2.5 text-xs font-medium flex-shrink-0 transition-colors"
                  style={{
                    color: view === id ? 'var(--accent-primary)' : 'var(--text-muted)',
                    borderBottom: view === id ? '2px solid var(--accent-primary)' : '2px solid transparent',
                  }}>
                  <Icon size={11} />
                  {label}
                  {typeof count === 'number' && count > 0 && (
                    <span className="text-xs px-1 py-0.5 rounded-full leading-none"
                      style={{ backgroundColor: 'var(--accent-subtle)', color: 'var(--accent-primary)',
                        fontSize: '10px' }}>
                      {count}
                    </span>
                  )}
                </button>
              ))}
              <div className="flex-1" />
              <button
                onClick={() => { initMarketplaceStore(); toast.info('Actualisé'); }}
                className="p-2.5 hover:bg-white/8 flex-shrink-0" style={{ color: 'var(--text-dimmed)' }}
                title="Actualiser (⟳)">
                <RefreshCw size={11} className={state.loading ? 'animate-spin' : ''} />
              </button>
            </div>

            {/* ── Contenu des vues ── */}
            <AnimatePresence mode="wait">

              {/* ACCUEIL */}
              {view === 'home' && (
                <motion.div key="home" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="flex-1 overflow-y-auto">

                  {/* Recherche rapide */}
                  <div className="px-3 pt-3 pb-2">
                    <div className="flex items-center gap-2 px-3 py-2 rounded-xl cursor-pointer"
                      style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-base)' }}
                      onClick={() => { setView('catalog'); setTimeout(() => searchRef.current?.focus(), 50); }}>
                      <Search size={13} style={{ color: 'var(--text-dimmed)' }} />
                      <span className="text-sm" style={{ color: 'var(--text-dimmed)' }}>
                        Rechercher... <kbd className="text-xs px-1 rounded"
                          style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-base)',
                            color: 'var(--text-dimmed)' }}>Ctrl+K</kbd>
                      </span>
                    </div>
                  </div>

                  {/* Catégories */}
                  <div className="px-3 pb-3">
                    <h2 className="text-xs font-bold uppercase tracking-wider mb-2"
                      style={{ color: 'var(--text-dimmed)' }}>Catégories</h2>
                    <div className="grid grid-cols-4 gap-1.5">
                      {(Object.entries(CATEGORY_LABELS).filter(([k]) => k !== '') as [MarketplaceCategory, string][])
                        .map(([key, label]) => {
                          const Icon = CATEGORY_ICONS[key] ?? Package;
                          return (
                            <button key={key}
                              onClick={() => { setView('catalog'); setActiveCategory(key); }}
                              className="flex flex-col items-center gap-1 p-2 rounded-xl hover:scale-105 transition-all"
                              style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-base)' }}>
                              <Icon size={15} style={{ color: 'var(--accent-primary)' }} />
                              <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{label}</span>
                            </button>
                          );
                        })}
                    </div>
                  </div>

                  {/* En vedette */}
                  {state.featured.length > 0 && (
                    <div className="px-3 pb-4">
                      <div className="flex items-center justify-between mb-2">
                        <h2 className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5"
                          style={{ color: 'var(--text-dimmed)' }}>
                          <Award size={11} style={{ color: '#eab308' }} /> En vedette
                        </h2>
                        <button onClick={() => setView('catalog')} className="text-xs"
                          style={{ color: 'var(--accent-primary)' }}>Voir tout</button>
                      </div>
                      <div className="space-y-2">
                        {state.featured.slice(0, 4).map(pkg => (
                          <PackageCard key={pkg.id} pkg={pkg} onSelect={handleSelect}
                            onInstall={handleInstall} onUninstall={handleUninstall}
                            installing={state.installLoading[pkg.id] ?? false} />
                        ))}
                      </div>
                    </div>
                  )}
                </motion.div>
              )}

              {/* CATALOGUE */}
              {view === 'catalog' && (
                <motion.div key="catalog" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="flex flex-col flex-1 overflow-hidden">
                  {/* Filtres */}
                  <div className="flex flex-col gap-2 p-3 border-b flex-shrink-0"
                    style={{ borderColor: 'var(--border-base)' }}>
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg"
                      style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-base)' }}>
                      <Search size={13} style={{ color: 'var(--text-dimmed)' }} />
                      <input ref={searchRef} value={state.searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        placeholder="Rechercher agents, skills…"
                        className="flex-1 bg-transparent text-sm outline-none"
                        style={{ color: 'var(--text-primary)' }} />
                      {state.searchQuery && (
                        <button onClick={() => setSearchQuery('')} style={{ color: 'var(--text-dimmed)' }}>
                          <X size={12} />
                        </button>
                      )}
                    </div>
                    <div className="flex gap-1.5">
                      {[
                        { val: state.activeType,     opts: TYPE_LABELS,     fn: (v: string) => setActiveType(v as any) },
                        { val: state.activeCategory, opts: CATEGORY_LABELS, fn: (v: string) => setActiveCategory(v as any) },
                        { val: state.activeSort,     opts: SORT_LABELS,     fn: (v: string) => setActiveSort(v as any) },
                      ].map((s, i) => (
                        <select key={i} value={s.val} onChange={e => s.fn(e.target.value)}
                          className="flex-1 px-2 py-1 rounded text-xs outline-none"
                          style={{ backgroundColor: 'var(--bg-surface)',
                            border: '1px solid var(--border-base)', color: 'var(--text-muted)' }}>
                          {Object.entries(s.opts).map(([k, v]) => (
                            <option key={k} value={k}>{v as string}</option>
                          ))}
                        </select>
                      ))}
                    </div>
                    <div className="flex items-center justify-between text-xs"
                      style={{ color: 'var(--text-dimmed)' }}>
                      <span className="flex items-center gap-1">
                        <Filter size={9} />
                        {state.total} résultat{state.total !== 1 ? 's' : ''}
                      </span>
                      {(state.searchQuery || state.activeType || state.activeCategory) && (
                        <button onClick={() => { setSearchQuery(''); setActiveType(''); setActiveCategory(''); }}
                          className="text-xs" style={{ color: 'var(--accent-primary)' }}>
                          Réinitialiser
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto p-3">
                    {state.loading ? (
                      <div className="flex items-center justify-center h-32 gap-2">
                        <RefreshCw size={18} className="animate-spin" style={{ color: 'var(--text-dimmed)' }} />
                        <span className="text-sm" style={{ color: 'var(--text-dimmed)' }}>Chargement…</span>
                      </div>
                    ) : state.packages.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-32 gap-2">
                        <Package size={24} style={{ color: 'var(--text-dimmed)' }} />
                        <span className="text-sm" style={{ color: 'var(--text-dimmed)' }}>Aucun résultat</span>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {state.packages.map(pkg => (
                          <PackageCard key={pkg.id} pkg={pkg} onSelect={handleSelect}
                            onInstall={handleInstall} onUninstall={handleUninstall}
                            installing={state.installLoading[pkg.id] ?? false} />
                        ))}
                      </div>
                    )}
                  </div>

                  {state.totalPages > 1 && (
                    <div className="flex items-center justify-center gap-2 p-2 border-t flex-shrink-0"
                      style={{ borderColor: 'var(--border-base)' }}>
                      <button onClick={() => setPage(state.page - 1)} disabled={state.page <= 1}
                        className="p-1 rounded hover:bg-white/8 disabled:opacity-30"
                        style={{ color: 'var(--text-muted)' }}><ChevronLeft size={14} /></button>
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {state.page}/{state.totalPages}
                      </span>
                      <button onClick={() => setPage(state.page + 1)} disabled={state.page >= state.totalPages}
                        className="p-1 rounded hover:bg-white/8 disabled:opacity-30"
                        style={{ color: 'var(--text-muted)' }}><ChevronRight size={14} /></button>
                    </div>
                  )}
                </motion.div>
              )}

              {/* INSTALLÉS */}
              {view === 'installed' && (
                <motion.div key="installed" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="flex-1 overflow-y-auto p-3">
                  {state.installed.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-40 gap-3">
                      <Package size={28} style={{ color: 'var(--text-dimmed)' }} />
                      <p className="text-sm text-center" style={{ color: 'var(--text-muted)' }}>
                        Aucun paquet installé.<br />Explore le catalogue !
                      </p>
                      <button onClick={() => setView('catalog')}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold"
                        style={{ backgroundColor: 'var(--accent-primary)', color: 'white' }}>
                        <LayoutGrid size={12} /> Catalogue
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {state.installed.map(pkg => (
                        <PackageCard key={pkg.id} pkg={pkg} onSelect={handleSelect}
                          onInstall={handleInstall} onUninstall={handleUninstall}
                          installing={state.installLoading[pkg.id] ?? false} />
                      ))}
                    </div>
                  )}
                </motion.div>
              )}

              {/* IMPORTER */}
              {view === 'import' && (
                <motion.div key="import" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="flex-1 overflow-y-auto p-4 space-y-4">
                  <div>
                    <h2 className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
                      Importer un paquet
                    </h2>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      Importe un fichier <code>.leanna.json</code> exporté depuis ce Marketplace ou partagé par la communauté.
                    </p>
                  </div>
                  <ImportDropzone onImported={() => setView('installed')} />
                </motion.div>
              )}

              {/* PUBLIER */}
              {view === 'publish' && (
                <motion.div key="publish" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="flex-1 overflow-hidden">
                  <PublishForm onDone={() => setView('catalog')} />
                </motion.div>
              )}

            </AnimatePresence>
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  );

  return (
    <SidePanel
      open={true}
      onClose={onClose}
      title="Marketplace"
      icon={Store}
      position="right"
      defaultWidth={440}
      minWidth={340}
      maxWidth={680}
      storageKey="marketplace"
      overlay={true}
    >
      {content}
    </SidePanel>
  );
}
