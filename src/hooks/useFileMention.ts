import { useState, useCallback, useEffect, useRef } from 'react';
import { ideApi, type TreeEntry } from '../services/ideApi.js';

export interface MentionSuggestion {
  name: string;
  path: string;
  type: 'file' | 'directory';
}

/**
 * Hook for @file/@folder mention autocomplete in chat input.
 * Detects "@" in the input, filters the file tree, and manages selection.
 */
export function useFileMention(input: string, cursorPos: number) {
  const [suggestions, setSuggestions] = useState<MentionSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionStart, setMentionStart] = useState(-1);
  const flatTreeRef = useRef<MentionSuggestion[]>([]);
  const treeLoadedRef = useRef(false);

  // Flatten tree recursively
  const flattenTree = useCallback((entries: TreeEntry[]): MentionSuggestion[] => {
    const result: MentionSuggestion[] = [];
    const walk = (items: TreeEntry[]) => {
      for (const item of items) {
        result.push({ name: item.name, path: item.path, type: item.type });
        if (item.children) walk(item.children);
      }
    };
    walk(entries);
    return result;
  }, []);

  // Load tree once on first need
  const loadTree = useCallback(async () => {
    if (treeLoadedRef.current) return;
    try {
      const entries = await ideApi.loadTree();
      flatTreeRef.current = flattenTree(entries);
      treeLoadedRef.current = true;
    } catch (err) {
      console.error('[FileMention] Failed to load tree:', err);
    }
  }, [flattenTree]);

  // Detect @ mention in input based on cursor position
  useEffect(() => {
    // Find the last "@" before cursor that's either at start or preceded by a space
    const textBeforeCursor = input.slice(0, cursorPos);
    const atIndex = textBeforeCursor.lastIndexOf('@');

    if (atIndex === -1) {
      setShowSuggestions(false);
      setMentionQuery('');
      setMentionStart(-1);
      return;
    }

    // "@" must be at start or preceded by whitespace
    if (atIndex > 0 && !/\s/.test(input[atIndex - 1])) {
      setShowSuggestions(false);
      setMentionQuery('');
      setMentionStart(-1);
      return;
    }

    // Extract the query after "@"
    const query = textBeforeCursor.slice(atIndex + 1);

    // Don't show if there's a space in the query (mention was completed or cancelled)
    if (query.includes(' ')) {
      setShowSuggestions(false);
      setMentionQuery('');
      setMentionStart(-1);
      return;
    }

    setMentionStart(atIndex);
    setMentionQuery(query);
    setShowSuggestions(true);
    setSelectedIndex(0);

    // Load tree if needed
    loadTree();
  }, [input, cursorPos, loadTree]);

  // Filter suggestions based on query
  useEffect(() => {
    if (!showSuggestions || !treeLoadedRef.current) {
      setSuggestions([]);
      return;
    }

    const q = mentionQuery.toLowerCase();
    const filtered = flatTreeRef.current
      .filter(item => {
        if (!q) return true;
        // Match against name or full path
        return item.name.toLowerCase().includes(q) || item.path.toLowerCase().includes(q);
      })
      .slice(0, 8); // Limit to 8 results

    setSuggestions(filtered);
  }, [mentionQuery, showSuggestions]);

  // Handle keyboard navigation in suggestions
  const handleMentionKeyDown = useCallback((e: React.KeyboardEvent): boolean => {
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
        return true; // Signal that a selection should happen
      }
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setShowSuggestions(false);
      return true;
    }
    return false;
  }, [showSuggestions, suggestions, selectedIndex]);

  // Build the new input after selecting a suggestion
  const acceptSuggestion = useCallback((suggestion: MentionSuggestion): { newInput: string; newCursorPos: number } => {
    const before = input.slice(0, mentionStart);
    const after = input.slice(cursorPos);
    const mention = `@${suggestion.path} `;
    const newInput = before + mention + after;
    const newCursorPos = before.length + mention.length;
    setShowSuggestions(false);
    return { newInput, newCursorPos };
  }, [input, mentionStart, cursorPos]);

  // Invalidate cache (useful when files change)
  const invalidateCache = useCallback(() => {
    treeLoadedRef.current = false;
    flatTreeRef.current = [];
  }, []);

  return {
    suggestions,
    showSuggestions,
    selectedIndex,
    setSelectedIndex,
    handleMentionKeyDown,
    acceptSuggestion,
    invalidateCache,
    mentionQuery,
  };
}
