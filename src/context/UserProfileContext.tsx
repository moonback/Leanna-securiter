import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ResponseStyle = 'concise' | 'balanced' | 'detailed';
export type Language      = 'fr' | 'en' | 'es' | 'de' | 'pt';
export type AIProvider    = 'gemini' | 'openrouter';

// Rôles d'agents statiques (prédéfini)
export const STATIC_AGENT_ROLES = [
  'coder', 'refactor', 'debugger', 'reviewer', 'tester', 'security', 'architect',
  'writer', 'formatter', 'researcher', 'proofreader', 'translator', 'summarizer', 'planner',
] as const;

// Type pour les rôles d'agents (statiques + dynamiques)
export type StaticAgentRole = (typeof STATIC_AGENT_ROLES)[number];
export type AgentRole = StaticAgentRole | string;

// Configuration d'un agent personnalisé
export interface CustomAgentConfig {
  id: string;
  role: string;
  name: string;
  description: string;
  avatar?: string;
  color?: string;
  systemPrompt?: string;
  capabilities?: string[];
  tools?: string[];
  temperature?: number;
  maxTokens?: number;
  maxConcurrency?: number;
  defaultTimeoutMs?: number;
  triggerKeywords?: string[];
  autoDelegate?: boolean;
  model?: string;
  createdAt?: string;
  updatedAt?: string;
  // Spécialisation des compétences (Skills)
  /**
   * Catégories d'outils associées à cet agent (ex: 'codebase', 'knowledge', 'verify')
   * Utilisé pour le routing automatique des requêtes vers l'agent approprié
   */
  toolCategories?: string[];
  /**
   * Mots-clés spécifiques pour la détection sémantique des requêtes
   * Ces mots-clés déclenchent la sélection de cet agent
   */
  toolKeywords?: string[];
  /**
   * Rôles d'agents prioritaires pour la délégation
   * Quand cet agent délègue, il privilégiera ces rôles
   */
  priorityDelegationRoles?: string[];
}

export interface AgentsConfig {
  enabled: boolean;
  allowedRoles: AgentRole[];
  // Agents personnalisés créés par l'utilisateur
  customAgents?: CustomAgentConfig[];
}

export interface UserProfile {
  // User identity
  userName:      string;   // Prénom de l'utilisateur (ex: "Mayss")
  userRole:      string;   // Ex: "développeur full-stack"
  // AI identity
  aiName:        string;   // Nom de l'IA (ex: "Leanna")
  aiVoice:       string;   // Voix Gemini Live (ex: "Aoede")
  // Behaviour
  language:      Language;
  responseStyle: ResponseStyle;
  // Auto Mute
  autoMuteEnabled: boolean;   // Activer le mode muet automatique
  autoMuteTimeout: number;    // Délai en secondes avant muet auto (5-300)
  // VAD (Voice Activity Detection)
  vadEnabled: boolean;        // Activer la détection de voix (économie bande passante)
  vadThreshold: number;       // Seuil d'amplitude pour détecter la voix (0-100)
  vadSilenceDuration: number; // Durée de silence en ms avant d'arrêter l'envoi (300-2000)
  // Model hyperparameters
  temperature:      number;  // 0.0–2.0, contrôle la créativité
  topP:             number;  // 0.0–1.0, nucleus sampling
  // Multi-model configuration
  textProvider:     AIProvider;   // Provider pour le texte/chat (gemini ou openrouter)
  openrouterModel:  string;       // Modèle OpenRouter sélectionné
  openrouterApiKey: string;       // Clé API OpenRouter (stockée localement)
  openrouterImageModel: string;   // Modèle OpenRouter pour la génération d'images/infographies
  // Appearance (kept here so Settings is the single source of truth)
  theme:         'dark' | 'light' | 'cyberpunk' | 'sepia' | 'high-contrast';
  accentColor:   string;
  // UI features
  floatingOrb:   boolean;  // Afficher l'orb flottant déplaçable
  // Token optimization
  compactPrompt: boolean;  // Utiliser le system prompt compact (−40% tokens)
  // Agent system
  agents:        AgentsConfig;  // Configuration du système multi-agents
  // Reasoning
  reasoningEnabled: boolean;  // Activer/désactiver le raisonnement structuré (CoT, etc.)
  // Custom system prompt
  customSystemPrompt: string;  // Prompt système personnalisé (ajouté au prompt de base)
}

const STORAGE_KEY = 'Leanna_user_profile';

const DEFAULT_PROFILE: UserProfile = {
  userName:      '',
  userRole:      '',
  aiName:        'Leanna',
  aiVoice:       'Aoede',
  language:      'fr',
  responseStyle: 'balanced',
  // Auto Mute
  autoMuteEnabled: false,   // Activé par défaut
  autoMuteTimeout: 40,     // 40 secondes par défaut
  // VAD (Voice Activity Detection)
  vadEnabled: true,        // Activé par défaut (économie bande passante)
  vadThreshold: 35,        // Seuil d'amplitude optimal pour la voix humaine
  vadSilenceDuration: 800, // 800ms de silence avant d'arrêter l'envoi
  // Model hyperparameters
  temperature:      0.9,
  topP:             0.95,
  textProvider:     'openrouter',
  openrouterModel:  'minimax/minimax-m3:free',
  openrouterApiKey: '',
  openrouterImageModel: 'google/gemini-3.6-flash-image',
  theme:         'cyberpunk',
  accentColor:   '#0ea5e9',
  floatingOrb:   false,
  compactPrompt: true,
  // Agents
  agents: {
    enabled: false,
    allowedRoles: [
      'coder', 'refactor', 'debugger', 'reviewer', 'tester', 'security', 'architect',
      'writer', 'formatter', 'researcher', 'proofreader', 'translator', 'summarizer', 'planner',
    ],
  },
  // Reasoning
  reasoningEnabled: true,
  // Custom system prompt
  customSystemPrompt: '',
};

function load(): UserProfile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_PROFILE, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULT_PROFILE };
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface ProfileContextValue {
  profile: UserProfile;
  setField: <K extends keyof UserProfile>(key: K, value: UserProfile[K]) => void;
  save: () => void;
  reset: () => void;
}

const ProfileContext = createContext<ProfileContextValue>({
  profile: DEFAULT_PROFILE,
  setField: () => {},
  save: () => {},
  reset: () => {},
});

export function useProfile() {
  return useContext(ProfileContext);
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function UserProfileProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = useState<UserProfile>(load);

  // Apply accent & theme on mount and on change
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', profile.theme);
    document.documentElement.style.setProperty('--accent-primary', profile.accentColor);
  }, [profile.theme, profile.accentColor]);

  const setField = useCallback(<K extends keyof UserProfile>(key: K, value: UserProfile[K]) => {
    setProfile(prev => ({ ...prev, [key]: value }));
  }, []);

  const save = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    // No need to call setProfile here as we're just saving to localStorage
  }, [profile]);

  const reset = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setProfile({ ...DEFAULT_PROFILE });
  }, []);

  const value = useMemo(() => ({ 
    profile, 
    setField, 
    save, 
    reset 
  }), [profile, setField, save, reset]);

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}
