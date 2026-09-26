import { User, Cpu, Languages, Palette, Key, Database, Trash2, SlidersHorizontal, Globe, Shield, ShieldCheck, Bot } from 'lucide-react';
import type { Language, ResponseStyle } from '../../context/UserProfileContext.js';

export const VOICES = [
  { id: 'Aoede',  label: 'Aoede',  desc: 'Douce & naturelle' },
  { id: 'Charon', label: 'Charon', desc: 'Grave & posée' },
  { id: 'Fenrir', label: 'Fenrir', desc: 'Énergique' },
  { id: 'Kore',   label: 'Kore',   desc: 'Claire & précise' },
  { id: 'Puck',   label: 'Puck',   desc: 'Légère & vivace' },
];

export const LANGUAGES: { id: Language; label: string; flag: string }[] = [
  { id: 'fr', label: 'Français', flag: '🇫🇷' },
  { id: 'en', label: 'English',  flag: '🇬🇧' },
  { id: 'es', label: 'Español',  flag: '🇪🇸' },
  { id: 'de', label: 'Deutsch',  flag: '🇩🇪' },
  { id: 'pt', label: 'Português', flag: '🇧🇷' },
];

export const RESPONSE_STYLES: { id: ResponseStyle; label: string; desc: string }[] = [
  { id: 'concise',  label: 'Concis',    desc: '1–3 phrases max' },
  { id: 'balanced', label: 'Équilibré', desc: 'Adapté au contexte' },
  { id: 'detailed', label: 'Détaillé',  desc: 'Réponses complètes' },
];

export const ACCENTS = [
  { label: 'Sky',     value: 'var(--color-info)' },
  { label: 'Violet',  value: 'var(--color-accent-alt)' },
  { label: 'Emerald', value: 'var(--color-success)' },
  { label: 'Rose',    value: 'var(--color-error)' },
  { label: 'Amber',   value: 'var(--color-warning)' },
];

/**
 * Catégories regroupées en 4 groupes pour réduire la charge cognitive.
 * Phase 4c du plan d'action : Général / IA & Modèles / Sécurité & Audit / Apparence & Données
 */
export const CATEGORIES = [
  // ─── Général ───
  { id: 'profile-settings', icon: User, label: 'Profil', description: 'Vos informations', group: 'Général' },
  { id: 'behavior-settings', icon: Languages, label: 'Comportement', description: 'Langue et style', group: 'Général' },
  // ─── IA & Modèles ───
  { id: 'ai-settings', icon: Cpu, label: 'Assistant IA', description: 'Nom et voix', group: 'IA & Modèles' },
  { id: 'agents-settings', icon: Bot, label: 'Agents', description: 'Multi-agents & rôles', group: 'IA & Modèles' },
  { id: 'openrouter-settings', icon: Globe, label: 'Multi-Modèle', description: 'OpenRouter & modèles', group: 'IA & Modèles' },
  { id: 'model-settings', icon: SlidersHorizontal, label: 'Modèle', description: 'Hyperparamètres', group: 'IA & Modèles' },
  { id: 'tokens-settings', icon: Key, label: 'Tokens', description: 'Clés API', group: 'IA & Modèles' },
  // ─── Sécurité & Audit ───
  { id: 'selfroot-settings', icon: Shield, label: 'Self-Root', description: 'IDE auto-référentiel', group: 'Sécurité & Audit' },
  { id: 'safeguards-settings', icon: ShieldCheck, label: 'Garde-fous', description: 'Protection auto-modification', group: 'Sécurité & Audit' },
  { id: 'audit-settings', icon: Database, label: 'Audit', description: 'Journal système', group: 'Sécurité & Audit' },
  // ─── Apparence & Données ───
  { id: 'appearance-settings', icon: Palette, label: 'Apparence', description: 'Thème et accent', group: 'Apparence & Données' },
  { id: 'data-settings', icon: Trash2, label: 'Données', description: 'Historique & stockage', group: 'Apparence & Données' },
];

export interface AuditEntry {
  timestamp: string;
  action: string;
  target: string;
  details?: string;
  actor?: string;
}
