import { useState, useCallback, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  Search, RotateCcw, Save, ChevronRight, Settings2,
  User, Cpu, Globe, SlidersHorizontal, Languages,
  Palette, Key, Database, Trash2, Shield, ShieldCheck, X, Code2, ArrowLeft, Bot, BookOpen, Layers, Send
} from 'lucide-react';
import { Tooltip } from '../components/ui/Tooltip.js';
import { useProfile } from '../context/UserProfileContext.js';
import { useToast } from '../components/ui/Toast.js';
import {
  ProfileSection,
  AiSection,
  BehaviorSection,
  AgentsSection,
  AppearanceSection,
  TokensSection,
  AuditSection,
  DataSection,
  ModelSection,
  OpenRouterSection,
  SelfRootSection,
  SafeguardsSection,
  CustomSkillsSection,
  KnowledgeHealthSection,
  SystemPromptSection,
  SkillsDocumentationSection,
  HierarchicalMemorySection,
  TelegramSection,
} from '../components/settings/index.js';

// ─── Nav Groups (4 catégories — Phase 4c du plan) ─────────────────────────────

const NAV_GROUPS = [
  {
    label: 'Général',
    items: [
      { id: 'profile-settings', icon: User, label: 'Profil', keywords: 'nom role prenom identité utilisateur' },
      { id: 'behavior-settings', icon: Languages, label: 'Comportement', keywords: 'langue francais english style reponse concis détaillé' },
    ],
  },
  {
    label: 'IA & Modèles',
    items: [
      { id: 'ai-settings', icon: Cpu, label: 'Assistant IA', keywords: 'voix nom ia leanna Leanna identité' },
      { id: 'systemprompt-settings', icon: Settings2, label: 'Prompt Système', keywords: 'prompt systeme instruction personnaliser comportement custom system' },
      { id: 'agents-settings', icon: Bot, label: 'Agents', keywords: 'agent multi-agents coder test docs refactor security review architect délégation solo' },
      { id: 'custom-skills-settings', icon: Code2, label: 'Skills custom', keywords: 'skill personnalisé custom outil tool instruction prompt automatisation' },
      { id: 'skills-doc-settings', icon: BookOpen, label: 'Documentation Skills', keywords: 'documentation doc skills outils tools paramètres schéma tester interactif auto-généré' },
      { id: 'telegram-settings', icon: Send, label: 'Bot Telegram', keywords: 'telegram bot mobile smartphone distant notifications token polling' },
      { id: 'openrouter-settings', icon: Globe, label: 'Modèles & API', keywords: 'openrouter cles providers gpt gemini claude modèle' },
      { id: 'model-settings', icon: SlidersHorizontal, label: 'Hyperparamètres', keywords: 'temperature top p créativité précis équilibré preset' },
      { id: 'tokens-settings', icon: Key, label: 'Tokens API', keywords: 'cle api gemini tokens pool rotation' },
    ],
  },
  {
    label: 'Sécurité & Connaissances',
    items: [
      { id: 'knowledge-settings', icon: Database, label: 'Knowledge System', keywords: 'graphe index ast arbre call-graph mémoire faits dépendances santé codebase réindexer fonctions' },
      { id: 'hierarchical-memory-settings', icon: Layers, label: 'Mémoire hiérarchique', keywords: 'mémoire hierarchique court moyen long terme session projet supabase' },
      { id: 'selfroot-settings', icon: Shield, label: 'Self-Root', keywords: 'workspace projet verrouillé périmètre branche' },
      { id: 'safeguards-settings', icon: ShieldCheck, label: 'Garde-fous', keywords: 'checkpoint rollback validation build test protection critique' },
      { id: 'audit-settings', icon: Database, label: 'Journal système', keywords: 'audit logs historique opérations traçabilité' },
    ],
  },
  {
    label: 'Apparence & Données',
    items: [
      { id: 'appearance-settings', icon: Palette, label: 'Apparence', keywords: 'theme sombre clair couleur accent orb interface' },
      { id: 'data-settings', icon: Trash2, label: 'Données', keywords: 'supprimer stockage cache reset conversations mémoire' },
    ],
  },
];

function getActiveLabel(id: string) {
  for (const g of NAV_GROUPS) {
    const found = g.items.find(i => i.id === id);
    if (found) return { group: g.label, label: found.label, Icon: found.icon };
  }
  return { group: '', label: id, Icon: Settings2 };
}

export default function SettingsView() {
  const navigate = useNavigate();
  const searchParams = new URLSearchParams(window.location.search);
  const { profile, save, reset } = useProfile();
  const { success, error: toastError } = useToast();
  const [saving, setSaving] = useState(false);
  const requestedSection = searchParams.get('section');
  const [activeSection, setActiveSection] = useState(
    requestedSection || 'profile-settings',
  );
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const sec = searchParams.get('section');
    if (sec) setActiveSection(sec);
  }, [window.location.search]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      save();
      await fetch('/api/profile', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          aiName: profile.aiName, aiVoice: profile.aiVoice,
          userName: profile.userName, userRole: profile.userRole,
          language: profile.language, responseStyle: profile.responseStyle,
          temperature: profile.temperature, topP: profile.topP,
          textProvider: profile.textProvider, openrouterModel: profile.openrouterModel,
          openrouterImageModel: profile.openrouterImageModel,
          agents: profile.agents,
          reasoningEnabled: profile.reasoningEnabled,
          customSystemPrompt: profile.customSystemPrompt,
        }),
      });
      success('Paramètres sauvegardés ✓');
      // Notifier la session live de se reconnecter pour prendre en compte
      // les changements qui affectent les déclarations d'outils (reasoning, agents, etc.)
      window.dispatchEvent(new CustomEvent('Leanna-settings-saved', { detail: { requiresReconnect: true } }));
    } catch { toastError('Erreur lors de la sauvegarde'); }
    finally { setSaving(false); }
  }, [save, profile, success, toastError]);

  const handleReset = useCallback(() => {
    reset();
    success('Paramètres réinitialisés');
  }, [reset, success]);

  // Filter groups and items based on search query
  const filteredNavGroups = useMemo(() => {
    if (!searchQuery.trim()) return NAV_GROUPS;
    const query = searchQuery.toLowerCase();
    return NAV_GROUPS.map(group => {
      const matchedItems = group.items.filter(item =>
        item.label.toLowerCase().includes(query) ||
        item.keywords.toLowerCase().includes(query) ||
        group.label.toLowerCase().includes(query)
      );
      return { ...group, items: matchedItems };
    }).filter(group => group.items.length > 0);
  }, [searchQuery]);

  const active = getActiveLabel(activeSection);

  return (
    <div className="h-full flex overflow-hidden font-sans text-xs" style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }}>

      {/* ── Left Sidebar Nav ── */}
      <nav
        className="flex flex-col flex-shrink-0 select-none"
        style={{
          width: 260,
          backgroundColor: 'var(--bg-sidebar)',
          borderRight: '1px solid var(--border-base)',
        }}
      >
        {/* Title */}
        <div className="px-4.5 pt-4 pb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Tooltip
              content="Retour"
              as="button"
              onClick={() => navigate(-1)}
              className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-[var(--ctrl-hover)]"
            >
              <ArrowLeft className="h-3.5 w-3.5" style={{ color: 'var(--text-muted)' }} />
            </Tooltip>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--text-secondary)' }}>
                Paramètres
              </p>
              <p className="text-[9px]" style={{ color: 'var(--text-dimmed)' }}>
                Personnalisation du workspace
              </p>
            </div>
          </div>
          <span className="rounded-full px-2 py-0.5 text-[8px] font-mono font-bold"
            style={{ backgroundColor: 'color-mix(in srgb, #10b981 12%, transparent)', color: '#10b981' }}>
            SELF-IDE
          </span>
        </div>

        {/* Search input */}
        <div className="px-3 pb-4">
          <div className="relative flex items-center">
            <Search className="absolute left-2.5 h-3.5 w-3.5 opacity-50" style={{ color: 'var(--text-muted)' }} />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Rechercher..."
              className="w-full rounded-xl border px-8 py-2 text-[11px] font-sans outline-none transition-all"
              style={{
                backgroundColor: 'var(--bg-input)',
                borderColor: 'var(--border-base)',
                color: 'var(--text-primary)',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.02)'
              }}
              onFocus={e => {
                e.currentTarget.style.borderColor = 'var(--accent-primary)';
                e.currentTarget.style.boxShadow = '0 0 0 3px var(--accent-subtle)';
              }}
              onBlur={e => {
                e.currentTarget.style.borderColor = 'var(--border-base)';
                e.currentTarget.style.boxShadow = 'inset 0 1px 0 rgba(255,255,255,0.02)';
              }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 rounded p-0.5 opacity-60 transition-opacity hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        {/* Navigation list */}
        <div className="flex-1 overflow-y-auto custom-scrollbar px-2.5 pb-4 space-y-4">
          {filteredNavGroups.map(group => (
            <div key={group.label} className="space-y-1">
              <p className="px-2 text-[9px] font-bold uppercase tracking-wider"
                style={{ color: 'var(--text-dimmed)' }}>
                {group.label}
              </p>
              <div className="space-y-0.5">
                {group.items.map(({ id, icon: Icon, label }) => {
                  const isActive = activeSection === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setActiveSection(id)}
                      className="group relative flex w-full items-center gap-2 rounded-xl border px-2.5 py-1.5 text-left transition-all duration-100"
                      style={{
                        backgroundColor: isActive ? 'var(--btn-active-bg)' : 'transparent',
                        borderColor: isActive ? 'var(--accent-subtle)' : 'transparent',
                        color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                        boxShadow: isActive ? 'inset 0 1px 0 rgba(255,255,255,0.04)' : 'none',
                      }}
                    >
                      {/* Active indicator */}
                      {isActive && (
                        <motion.div
                          layoutId="settings-nav-indicator"
                          className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-sm"
                          style={{ backgroundColor: 'var(--accent-primary)' }}
                          transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                        />
                      )}

                      <Icon
                        className="h-3.5 w-3.5 opacity-70 group-hover:opacity-100 transition-opacity"
                        style={{ color: isActive ? 'var(--accent-primary)' : 'var(--text-muted)' }}
                      />
                      <span className="text-[11px] font-medium truncate">
                        {label}
                      </span>

                      {/* Security badge for self-root related items */}
                      {(id === 'selfroot-settings' || id === 'safeguards-settings') && (
                        <span className="ml-auto rounded px-1 py-0.5 text-[7px] font-bold"
                          style={{
                            backgroundColor: 'color-mix(in srgb, #10b981 12%, transparent)',
                            color: '#10b981',
                          }}>
                          🔒
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {filteredNavGroups.length === 0 && (
            <p className="text-[10px] text-center pt-4" style={{ color: 'var(--text-dimmed)' }}>
              Aucun résultat trouvé
            </p>
          )}
        </div>

        {/* Bottom info */}
        {/* <div className="px-3 py-3 flex-shrink-0" style={{ borderTop: '1px solid var(--border-base)' }}>
          <div className="rounded-lg p-2.5"
            style={{ backgroundColor: 'color-mix(in srgb, var(--accent-primary) 5%, transparent)' }}>
            <p className="text-[9px] leading-relaxed" style={{ color: 'var(--text-dimmed)' }}>
              💡 Leanna ne modifie que son propre code source. Toute écriture crée un checkpoint automatique.
            </p>
          </div>
        </div> */}
      </nav>

      {/* ── Main content area ── */}
      <div className="flex flex-1 flex-col overflow-hidden">

        {/* Header toolbar */}
        <header
          className="flex flex-shrink-0 items-center justify-between px-5 py-3 lg:px-7"
          style={{
            backgroundColor: 'var(--bg-panel)',
            borderBottom: '1px solid var(--border-base)',
          }}
        >
          {/* Breadcrumbs */}
          <div className="flex items-center gap-1.5 text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
            <span>settings</span>
            <ChevronRight className="h-3 w-3 opacity-60" />
            <span style={{ color: 'var(--text-secondary)' }}>{active.group.toLowerCase()}</span>
            <ChevronRight className="h-3 w-3 opacity-60" />
            <span style={{ color: 'var(--accent-primary)' }}>{active.label.toLowerCase()}</span>
          </div>

          {/* Quick Actions */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleReset}
              className="flex items-center gap-1 rounded border px-2.5 py-1 text-[10.5px] font-medium transition-all hover:opacity-80"
              style={{
                color: 'var(--text-secondary)',
                borderColor: 'var(--border-strong)',
                backgroundColor: 'var(--bg-secondary)'
              }}
            >
              <RotateCcw className="h-3 w-3" />
              Réinitialiser
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1 rounded px-3 py-1 text-[10.5px] font-semibold transition-all disabled:opacity-50"
              style={{
                backgroundColor: 'var(--accent-primary)',
                color: '#fff',
              }}
            >
              <Save className="h-3 w-3" />
              {saving ? 'Enregistrement...' : 'Enregistrer'}
            </button>
          </div>
        </header>

        {/* Settings editor canvas */}
        <main className="flex-1 overflow-y-auto px-10 py-6 custom-scrollbar" style={{ backgroundColor: 'var(--bg-base)' }}>
          <div className="mx-auto max-w-7xl">
            {/* Title Section */}
            <div className="mb-4 rounded-2xl border p-4" style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-base)', boxShadow: 'var(--shadow-sm)' }}>
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ backgroundColor: 'var(--accent-subtle)' }}>
                  <active.Icon className="h-4 w-4" style={{ color: 'var(--accent-primary)' }} />
                </div>
                <div>
                  <h1 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {active.label}
                  </h1>
                  <p className="mt-0.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                    {getSectionDescription(activeSection)}
                  </p>
                </div>
              </div>
            </div>

            {/* Components render */}
            <AnimatePresence mode="wait">
              <motion.div
                key={activeSection}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -3 }}
                transition={{ duration: 0.12, ease: 'easeOut' }}
              >
                {activeSection === 'profile-settings' && <ProfileSection />}
                {activeSection === 'ai-settings' && <AiSection />}
                {activeSection === 'systemprompt-settings' && <SystemPromptSection />}
                {activeSection === 'agents-settings' && <AgentsSection />}
                {activeSection === 'custom-skills-settings' && <CustomSkillsSection />}
                {activeSection === 'openrouter-settings' && <OpenRouterSection />}
                {activeSection === 'model-settings' && <ModelSection />}
                {activeSection === 'behavior-settings' && <BehaviorSection />}
                {activeSection === 'appearance-settings' && <AppearanceSection />}
                {activeSection === 'tokens-settings' && <TokensSection />}
                {activeSection === 'knowledge-settings' && <KnowledgeHealthSection />}
                {activeSection === 'audit-settings' && <AuditSection />}
                {activeSection === 'selfroot-settings' && <SelfRootSection />}
                {activeSection === 'safeguards-settings' && <SafeguardsSection />}
                {activeSection === 'data-settings' && <DataSection />}
                {activeSection === 'skills-doc-settings' && <SkillsDocumentationSection />}
                {activeSection === 'hierarchical-memory-settings' && <HierarchicalMemorySection />}
                {activeSection === 'telegram-settings' && <TelegramSection />}
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getSectionDescription(id: string): string {
  const descriptions: Record<string, string> = {
    'profile-settings': 'Personnalisez votre identité pour des échanges adaptés.',
    'ai-settings': 'Configurez le nom et la voix de votre assistant IA.',
    'systemprompt-settings': 'Personnalisez les instructions système de l\'assistant.',
    'agents-settings': 'Activez ou désactivez les agents spécialisés (coder, test, docs, etc.).',
    'custom-skills-settings': 'Créez et gérez vos skills personnalisés stockés en BDD.',
    'openrouter-settings': 'Sélectionnez votre provider et modèle pour les requêtes texte.',
    'model-settings': 'Ajustez la créativité et la cohérence des réponses.',
    'behavior-settings': 'Langue, style et format des réponses de l\'IA.',
    'appearance-settings': 'Thème visuel, couleur d\'accent et éléments d\'interface.',
    'tokens-settings': 'Gérez vos clés API et le pool de rotation Gemini.',
    'knowledge-settings': 'Analysez et contrôlez la santé du Knowledge System et du graphe de dépendances.',
    'audit-settings': 'Consultez le journal des opérations système.',
    'selfroot-settings': 'Périmètre verrouillé — l\'IDE n\'opère que sur son propre repo.',
    'safeguards-settings': 'Checkpoints, validation et protections pour l\'auto-modification.',
    'data-settings': 'Supprimez l\'historique des conversations et la mémoire.',
    'skills-doc-settings': 'Documentation interactive des skills et outils, auto-générée depuis leurs déclarations TypeScript.',
    'hierarchical-memory-settings': 'Orchestrez la mémoire à 3 niveaux : court-terme (session), moyen-terme (projet) et long-terme (Supabase).',
    'telegram-settings': 'Contrôlez Leanna depuis votre smartphone : chat IA, exécution de tâches agents et notifications.',
  };
  return descriptions[id] || 'Configurez les préférences de cette section.';
}
