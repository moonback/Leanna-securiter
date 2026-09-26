/**
 * Shared types for IDE components
 */

export type TreeEntry = {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: TreeEntry[];
};

export type OpenFile = {
  path: string;
  content: string;
  dirty: boolean;
  language: string;
  type?: 'file' | 'browser';
  browserUrl?: string;
};

export type IdeSettings = {
  fontSize: number;
  theme: 'vs-dark' | 'vs' | 'hc-black' | 'hc-light';
  wordWrap: boolean;
  tabSize: number;
  showMinimap: boolean;
  showWhitespace: boolean;
  stickyScroll: boolean;
  bracketPairs: boolean;
  devServerPort: number;
};

export const DEFAULT_IDE_SETTINGS: IdeSettings = {
  fontSize: 14,
  theme: 'vs',
  wordWrap: true,
  tabSize: 2,
  showMinimap: false,
  showWhitespace: false,
  stickyScroll: true,
  bracketPairs: true,
  devServerPort: 5173,
};
