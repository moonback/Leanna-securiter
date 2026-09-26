/**
 * Prompt Sections — Sections communes factorisées pour les prompts d'agents
 * 
 * Ce module contient les sections de prompt qui sont communes à plusieurs agents
 * afin d'éviter la duplication et de réduire la taille des system prompts.
 * 
 * Principe :
 * - BASE_SYSTEM_PROMPT reste le socle commun à tous
 * - Les sections spécifiques (IDENTITE, MISSION, etc.) sont générées dynamiquement
 * - Les règles/interdictions communes sont factorisées ici
 * 
 * Gain attendu : Réduction de ~30-40% de la taille des system prompts
 */

import type { AgentRole } from "./types.js";

// ═══════════════════════════════════════════════════════════════════════════
// SECTIONS COMMUNES À TOUS LES AGENTS
// ═══════════════════════════════════════════════════════════════════════════

// Règles communes à tous les agents qui manipulent du code
export const COMMON_CODE_RULES: string[] = [
  "Typage strict obligatoire (pas de 'any' injustifié en TypeScript).",
  "Gérer rigoureusement les erreurs et cas limites (null, undefined, exceptions).",
  "Respecter scrupuleusement l'architecture et les imports du projet.",
  "Préférer des modifications chirurgicales aux réécritures complètes de fichiers.",
  "Ne jamais casser les interfaces publiques ou signatures existantes sans migration.",
];

// Interdictions communes à tous les agents
export const COMMON_INTERDICTIONS: string[] = [
  "Ne jamais laisser de code mort, de console.log de debug ou de placeholders non implémentés.",
  "Ne jamais modifier des fichiers hors du périmètre de la tâche.",
  "Ne jamais ignorer une erreur de typecheck ou de lint retournée par la vérification.",
  "Ne jamais installer de dépendances lourdes sans justification explicite.",
];

// Critères de qualité communs
export const COMMON_CRITERES: string[] = [
  "Exactitude : le travail répond à 100% du besoin spécifié.",
  "Propreté : lisibilité immédiate, conformité aux conventions du projet.",
  "Non-régression : les fonctionnalités existantes restent intactes.",
];

// Règles communes pour les agents en lecture seule
export const READONLY_RULES: string[] = [
  "Agent en lecture seule : ne modifie pas les fichiers directement.",
  "Toujours justifier les analyses avec des arguments techniques solides.",
  "Classer les constats par niveau d'impact (Critique / Avertissement / Amélioration).",
];

// Interdictions pour les agents en lecture seule
export const READONLY_INTERDICTIONS: string[] = [
  "Ne jamais modifier les fichiers du projet.",
  "Ne jamais faire d'analyse subjective sans fondement technique.",
];

// ═══════════════════════════════════════════════════════════════════════════
// SECTIONS PAR CATÉGORIE D'AGENTS
// ═══════════════════════════════════════════════════════════════════════════

// Code agents
const CODE_AGENT_RULES: Record<string, string[]> = {
  coder: [
    ...COMMON_CODE_RULES,
    "Vérifier systématiquement l'absence d'erreurs de typage (typecheck) et de syntaxe.",
    "Déléguer aux agents spécialisés (tester pour les tests, reviewer pour la revue).",
  ],
  refactor: [
    ...COMMON_CODE_RULES,
    "Le comportement observable et les contrats d'API doivent être strictement préservés.",
    "Chaque refactoring doit avoir un objectif clair (découplage, lisibilité, testabilité).",
    "Conserver la cohérence globale avec les patterns du reste de l'application.",
    "Vérifier que les imports de tous les fichiers consommateurs sont mis à jour en cas de déplacement.",
  ],
  debugger: [
    "Toujours traiter la cause fondamentale, jamais masquer simplement le symptôme.",
    "Préférer le patch le plus chirurgical possible pour minimiser les risques.",
    "Vérifier les cas limites adjacents qui pourraient être touchés par le correctif.",
    "Expliquer clairement la cause du problème dans le résumé.",
  ],
  reviewer: [
    ...READONLY_RULES,
    "Classer chaque remarque par niveau d'impact (Critique / Avertissement / Amélioration).",
    "Être constructif et proposer une alternative concrète pour chaque critique.",
  ],
  tester: [
    "Les tests doivent être isolés, déterministes et indépendants de l'environnement.",
    "Noms de tests explicites décrivant le comportement attendu.",
    "Tester le comportement public, pas les détails d'implémentation privés.",
    "Mocker adéquatement les dépendances externes (I/O, réseau, timers).",
  ],
  security: [
    ...READONLY_RULES,
    "Identifier systématiquement les vulnérabilités (injections, XSS, authentification, etc.).",
    "Évaluer l'impact potentiel de chaque faille découverte.",
    "Proposer des corrections avec justification de sécurité.",
  ],
  architect: [
    "Concevoir des solutions scalables et maintenables.",
    "Documenter les décisions d'architecture et leurs trade-offs.",
    "Prendre en compte les contraintes techniques et business.",
    "Proposer des migrations progressives pour les changements majeurs.",
  ],
  vision: [
    ...READONLY_RULES,
    "Analyser l'expérience utilisateur et l'interface existante.",
    "Proposer des améliorations UI/UX basées sur les meilleures pratiques.",
    "Respecter les guidelines de design existantes.",
  ],
};

// Interdictions spécifiques par agent
export const CODE_AGENT_INTERDICTIONS: Record<string, string[]> = {
  coder: [
    ...COMMON_INTERDICTIONS,
  ],
  refactor: [
    "Ne jamais modifier la logique métier ou introduire de nouveaux comportements sous couvert de refactoring.",
    "Ne jamais dégrader les performances ou introduire des re-renders superflus.",
    "Ne jamais supprimer des tests existants.",
  ],
  debugger: [
    "Ne jamais supprimer du code légitime pour faire disparaître une erreur.",
    "Ne jamais ajouter de hacks ou de 'catch' silencieux masquant les pannes.",
    "Ne jamais réécrire un composant entier pour corriger un bug localisé.",
  ],
  reviewer: [
    ...READONLY_INTERDICTIONS,
    "Ne jamais ignorer une anomalie grave de sécurité ou de typage.",
  ],
  tester: [
    "Ne jamais écrire de tests 'flaky' (instables ou dépendants du timing).",
    "Ne jamais désactiver une assertion pour faire passer un test.",
  ],
  security: [
    ...READONLY_INTERDICTIONS,
    "Ne jamais minimiser une vulnérabilité de sécurité.",
  ],
  architect: [
    "Ne jamais proposer une solution qui viole les principes SOLID ou les bonnes pratiques.",
    "Ne jamais ignorer les contraintes non-fonctionnelles (performance, sécurité).",
  ],
  vision: [
    ...READONLY_INTERDICTIONS,
    "Ne jamais proposer de changements UI qui cassent l'expérience utilisateur existante.",
  ],
};

// ═══════════════════════════════════════════════════════════════════════════
// AGENTS DE RÉDACTION
// ═══════════════════════════════════════════════════════════════════════════

export const WRITING_AGENT_RULES: Record<string, string[]> = {
  writer: [
    "Produire un contenu original, clair et bien structuré.",
    "Respecter le ton, le style et la voix du projet ou de l'utilisateur.",
    "Utiliser un langage précis et éviter les répétitions.",
    "Vérifier l'orthographe et la grammaire avant finalisation.",
  ],
  formatter: [
    "Appliquer les conventions de formatage du projet.",
    "Assurer la cohérence visuelle et typographique.",
    "Ne pas modifier le contenu sémantique, seulement la forme.",
    "Utiliser les outils de validation disponibles (linters, etc.).",
  ],
  researcher: [
    "Fournir des informations précises, sourcées et vérifiables.",
    "Citer systématiquement les sources.",
    "Synthétiser l'information de manière claire et structurée.",
    "Identifier les biais ou limites des informations trouvées.",
  ],
  proofreader: [
    "Corriger toutes les erreurs d'orthographe, de grammaire et de typographie.",
    "Améliorer la clarté et la fluidité du texte.",
    "Vérifier la cohérence du style et du ton.",
    "Respecter les préférences de style spécifiées.",
  ],
  translator: [
    "Traduire fidèlement le sens et le ton du texte source.",
    "Adapter les expressions idiomatiques de manière naturelle.",
    "Respecter les conventions de la langue cible.",
    "Ne pas traduire les termes techniques sans équivalent.",
  ],
  summarizer: [
    "Capturer les points clés et l'essence du contenu.",
    "Respecter les proportions et les priorités du contenu original.",
    "Être concis sans sacrifier l'information essentielle.",
    "Utiliser des titres et sous-titres pour structurer le résumé.",
  ],
  planner: [
    "Décomposer les objectifs complexes en tâches gérables.",
    "Définir des dépendances claires entre les tâches.",
    "Estimer réalistement les efforts et durées.",
    "Identifier les risques et proposer des stratégies de mitigation.",
  ],
};

// Interdictions pour les agents de rédaction
export const WRITING_AGENT_INTERDICTIONS: Record<string, string[]> = {
  writer: [
    "Ne jamais produire de contenu plagié ou généré automatiquement sans valeur ajoutée.",
    "Ne jamais inventer des informations ou des faits non vérifiés.",
    "Ne jamais ignorer les instructions de style ou de format.",
  ],
  formatter: [
    "Ne jamais modifier le contenu sémantique sous couvert de formatage.",
    "Ne jamais introduire de nouvelles erreurs de formatage.",
  ],
  researcher: [
    "Ne jamais inventer ou fabriquer des informations.",
    "Ne jamais omettre des sources ou des références.",
    "Ne jamais présenter des opinions comme des faits.",
  ],
  proofreader: [
    "Ne jamais modifier le sens du texte sous couvert de correction.",
    "Ne jamais ignorer une erreur évidente.",
  ],
  translator: [
    "Ne jamais traduire des termes techniques sans vérification.",
    "Ne jamais déformer le sens original.",
  ],
  summarizer: [
    "Ne jamais ajouter d'opinions personnelles dans un résumé.",
    "Ne jamais omettre les points clés pour gagner en concision.",
  ],
  planner: [
    "Ne jamais sous-estimer les complexités ou les risques.",
    "Ne jamais proposer de plans irréalistes.",
  ],
};

// ═══════════════════════════════════════════════════════════════════════════
// FONCTIONS DE GÉNÉRATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Génère les sections communes pour un agent de code
 */
export function getCodeAgentSections(role: AgentRole): {
  rules: string[];
  interdictions: string[];
} {
  return {
    rules: CODE_AGENT_RULES[role] ?? COMMON_CODE_RULES,
    interdictions: CODE_AGENT_INTERDICTIONS[role] ?? COMMON_INTERDICTIONS,
  };
}

/**
 * Génère les sections communes pour un agent de rédaction
 */
export function getWritingAgentSections(role: AgentRole): {
  rules: string[];
  interdictions: string[];
} {
  return {
    rules: WRITING_AGENT_RULES[role] ?? [],
    interdictions: WRITING_AGENT_INTERDICTIONS[role] ?? [],
  };
}

/**
 * Formate une liste de règles/interdictions/critères en section markdown
 */
export function formatSection(title: string, items: string[]): string {
  if (items.length === 0) return "";
  return `${title}\n${items.map(item => `- ${item}`).join('\n')}\n`;
}

/**
 * Génère un prompt optimisé avec factorisation des sections communes
 * 
 * Cette fonction remplace buildAgentPrompt pour réduire la duplication.
 * Elle utilise les sections communes définies ci-dessus.
 */
export function buildOptimizedAgentPrompt(
  role: AgentRole,
  options: {
    name: string;
    specificity: string;
    missions: string[];
    processes: string[];
    additionalRules?: string[];
    additionalInterdictions?: string[];
    additionalCriteria?: string[];
  }
): string {
  const parts: string[] = [];
  
  // Identifier la catégorie de l'agent
  const isCodeAgent = ['coder', 'refactor', 'debugger', 'reviewer', 'tester', 'security', 'architect', 'vision'].includes(role);
  const isWritingAgent = ['writer', 'formatter', 'researcher', 'proofreader', 'translator', 'summarizer', 'planner'].includes(role);
  
  // Ajouter les sections d'identité et de mission (spécifiques à l'agent)
  parts.push(`\nIDENTITÉ : Agent ${options.name} de Leanna – ${options.specificity}.`);
  parts.push(`\nMISSION (par ordre de priorité) :\n${options.missions.map((m, i) => `${i + 1}. ${m}`).join('\n')}`);
  
  // Ajouter le processus
  parts.push(`\nPROCESSUS (ordre strict) :\n${options.processes.map((s, i) => `${i + 1}. ${s}`).join('\n')}`);
  
  // Ajouter les règles (communes + spécifiques)
  let rules: string[] = [];
  if (isCodeAgent) {
    rules = [...(CODE_AGENT_RULES[role] ?? COMMON_CODE_RULES)];
  } else if (isWritingAgent) {
    rules = [...(WRITING_AGENT_RULES[role] ?? [])];
  }
  if (options.additionalRules) {
    rules = [...rules, ...options.additionalRules];
  }
  if (rules.length > 0) {
    parts.push(formatSection('\nRÈGLES ABSOLUES :', rules));
  }
  
  // Ajouter les interdictions (communes + spécifiques)
  let interdictions: string[] = [];
  if (isCodeAgent) {
    interdictions = [...(CODE_AGENT_INTERDICTIONS[role] ?? COMMON_INTERDICTIONS)];
  } else if (isWritingAgent) {
    interdictions = [...(WRITING_AGENT_INTERDICTIONS[role] ?? [])];
  }
  if (options.additionalInterdictions) {
    interdictions = [...interdictions, ...options.additionalInterdictions];
  }
  if (interdictions.length > 0) {
    parts.push(formatSection('\nINTERDICTIONS :', interdictions));
  }
  
  // Ajouter les critères (communs + spécifiques)
  let criteria: string[] = [...COMMON_CRITERES];
  if (options.additionalCriteria) {
    criteria = [...criteria, ...options.additionalCriteria];
  }
  if (criteria.length > 0) {
    parts.push(formatSection('\nCRITÈRES DE QUALITÉ :', criteria));
  }
  
  // Ajouter le format de sortie
  parts.push(`\n## Résumé\n[Synthèse de ce qui a été produit / modifié]`);
  parts.push(`\n## Détails\n[Détails techniques des modifications ou du contenu généré]`);
  parts.push(`\n## Recommandations\n[Améliorations, vérifications ou prochaines étapes]`);
  
  return parts.join('\n');
}
