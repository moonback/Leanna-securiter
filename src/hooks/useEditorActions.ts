import { useCallback, useEffect, useRef } from 'react';

/**
 * Hook for managing Monaco editor actions (format, save, etc.)
 */
export function useEditorActions() {
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);
  // Track which file path the editor currently holds
  const editorPathRef = useRef<string | null>(null);

  // Format current file
  const formatDocument = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor) return;

    try {
      await editor.getAction('editor.action.formatDocument')?.run();
    } catch (e) {
      console.warn('Format document failed:', e);
    }
  }, []);

  // Navigate to specific line/column
  const navigateToPosition = useCallback((line: number, column?: number) => {
    if (!editorRef.current) return;
    
    setTimeout(() => {
      editorRef.current?.revealLineInCenter(line);
      if (typeof column === 'number') {
        editorRef.current?.setPosition({ lineNumber: line, column });
      }
      editorRef.current?.focus();
    }, 100);
  }, []);

  // Apply settings to editor instance
  const applySettingsToEditor = useCallback((editor: any, settings: any) => {
    if (!editor) return;
    editor.updateOptions({
      fontSize: settings.fontSize,
      wordWrap: settings.wordWrap ? 'on' : 'off',
      tabSize: settings.tabSize,
      minimap: { enabled: settings.showMinimap },
      renderWhitespace: settings.showWhitespace ? 'all' : 'none',
      stickyScroll: { enabled: settings.stickyScroll },
      bracketPairColorization: { enabled: settings.bracketPairs },
      guides: { bracketPairs: settings.bracketPairs, indentation: true },
    });
  }, []);

  /**
   * Forcefully push new content into Monaco's model.
   * Must be called after reloadFile() updates React state so Monaco
   * reflects the fresh disk content immediately.
   */
  const pushContentToEditor = useCallback((filePath: string, content: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    // Only update if this editor is currently showing that file
    if (editorPathRef.current !== filePath) return;
    const model = editor.getModel();
    if (!model) return;
    // Preserve cursor position around the update
    const position = editor.getPosition();
    model.pushEditOperations(
      [],
      [{ range: model.getFullModelRange(), text: content }],
      () => null
    );
    if (position) {
      editor.setPosition(position);
    }
  }, []);

  return {
    editorRef,
    monacoRef,
    editorPathRef,
    formatDocument,
    navigateToPosition,
    applySettingsToEditor,
    pushContentToEditor,
  };
}
