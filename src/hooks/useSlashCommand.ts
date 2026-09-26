import { useState, useCallback, useEffect, useRef } from 'react';

export interface SlashCommandSuggestion {
  name: string;
  description: string;
}

/**
 * Liste des skills disponibles pour les commandes slash.
 * Cette liste est synchronisée avec les skills enregistrées dans le SkillManager côté serveur.
 */
const AVAILABLE_SKILLS: SlashCommandSuggestion[] = [
  { name: 'automation', description: 'Gérer les tâches automatisées et workflows' },
  { name: 'codebase', description: 'Analyser et naviguer dans le code source' },
  { name: 'git', description: 'Opérations Git (commit, branch, status…)' },
  { name: 'github', description: 'Interactions GitHub (issues, PRs, repos)' },
  { name: 'guidelines', description: 'Consulter et appliquer les conventions du projet' },
  { name: 'history', description: 'Historique des conversations et actions' },
  { name: 'list', description: 'Gérer des listes (todo, notes, etc.)' },
  { name: 'memory', description: 'Mémoriser et rappeler des informations' },
  { name: 'reasoning', description: 'Raisonnement avancé et analyse approfondie' },
  { name: 'system', description: 'Commandes système (fichiers, terminal)' },
  { name: 'time', description: 'Date, heure et fuseaux horaires' },
  { name: 'verify', description: 'Vérifier et valider des fichiers' },
  { name: 'weather', description: 'Informations météo' },
];

/**
 * Hook for /command slash autocomplete in chat input.
 * Detects "/" at the beginning of input and shows matching skill suggestions.
 */
export function useSlashCommand(input: string, cursorPos: number) {
  const [suggestions, setSuggestions] = useState<SlashCommandSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [commandQuery, setCommandQuery] = useState('');
  const skillsRef = useRef<SlashCommandSuggestion[]>(AVAILABLE_SKILLS);

  // Detect / command at the start of input
  useEffect(() => {
    // "/" must be the first character
    if (!input.startsWith('/')) {
      setShowSuggestions(false);
      setCommandQuery('');
      return;
    }

    // Extract query after "/"
    const query = input.slice(1, cursorPos);

    // Don't show if there's a space (command already typed, user is typing args)
    if (query.includes(' ')) {
      setShowSuggestions(false);
      setCommandQuery('');
      return;
    }

    setCommandQuery(query);
    setShowSuggestions(true);
    setSelectedIndex(0);
  }, [input, cursorPos]);

  // Filter suggestions based on query
  useEffect(() => {
    if (!showSuggestions) {
      setSuggestions([]);
      return;
    }

    const q = commandQuery.toLowerCase();
    const filtered = skillsRef.current.filter(skill => {
      if (!q) return true;
      return skill.name.toLowerCase().includes(q) || skill.description.toLowerCase().includes(q);
    });

    setSuggestions(filtered);
  }, [commandQuery, showSuggestions]);

  // Handle keyboard navigation
  const handleSlashKeyDown = useCallback((e: React.KeyboardEvent): boolean => {
    if (!showSuggestions || suggestions.length === 0) return false;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => (i + 1) % suggestions.length);
      return true;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => (i - 1 + suggestions.length) % suggestions.length);
      return true;
    }
    if (e.key === 'Tab' || e.key === 'Enter') {
      if (suggestions[selectedIndex]) {
        e.preventDefault();
        return true;
      }
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setShowSuggestions(false);
      return true;
    }
    return false;
  }, [showSuggestions, suggestions, selectedIndex]);

  // Build the new input after selecting a command
  const acceptCommand = useCallback((suggestion: SlashCommandSuggestion): { newInput: string; newCursorPos: number } => {
    const command = `/${suggestion.name} `;
    setShowSuggestions(false);
    return { newInput: command, newCursorPos: command.length };
  }, []);

  return {
    suggestions,
    showSuggestions,
    selectedIndex,
    setSelectedIndex,
    handleSlashKeyDown,
    acceptCommand,
    commandQuery,
  };
}
