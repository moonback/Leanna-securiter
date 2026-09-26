import React from 'react';
import {
  FileText, FileJson, FileImage,
  File, Settings, Database, Globe, Type,
  Terminal, BookOpen, Palette, ShieldCheck,
  Zap, BrainCircuit, Code2
} from 'lucide-react';

// ── Couleurs par extension — basées sur les tokens du design system ─────────
const cyan = 'var(--accent-primary)';
const orange = 'var(--accent-secondary)';
const muted = 'var(--text-muted)';
const doc = 'var(--text-secondary)';

const EXT_COLOR: Record<string, string> = {
  ts: cyan, tsx: cyan,
  js: orange, jsx: orange, cjs: orange, mjs: orange,
  html: orange,
  css: cyan, scss: cyan, sass: cyan,
  json: orange,
  yaml: cyan, yml: cyan,
  sql: orange,
  md: doc, txt: muted,
  env: orange,
  gitignore: orange,
  lock: muted,
  toml: cyan,
  py: cyan,
  sh: cyan, bash: cyan, zsh: cyan,
  config: cyan, cfg: cyan, ini: cyan,
  cjs_: orange,
};

// ── Icône par extension ────────────────────────────────────────────────────
function pickIcon(ext: string): React.ComponentType<{ size?: number; color?: string }> {
  if (['ts', 'tsx'].includes(ext)) return Type;
  if (['js', 'jsx', 'cjs', 'mjs'].includes(ext)) return Code2;
  if (['py'].includes(ext)) return Zap;
  if (['json'].includes(ext)) return FileJson;
  if (['yaml', 'yml'].includes(ext)) return BrainCircuit;
  if (['md'].includes(ext)) return BookOpen;
  if (['txt'].includes(ext)) return FileText;
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) return FileImage;
  if (['html', 'htm'].includes(ext)) return Globe;
  if (['css', 'scss', 'sass'].includes(ext)) return Palette;
  if (['sql', 'db', 'sqlite'].includes(ext)) return Database;
  if (['sh', 'bash', 'zsh'].includes(ext)) return Terminal;
  if (['env', 'config', 'cfg', 'ini', 'toml'].includes(ext)) return Settings;
  if (['gitignore'].includes(ext)) return ShieldCheck;
  if (['lock'].includes(ext)) return FileJson;
  return File;
}

interface FileIconProps {
  filePath: string;
  size?: number;
}

export function FileIcon({ filePath, size = 15 }: FileIconProps) {
  const name = filePath.split('/').pop() ?? filePath;

  // Cas spéciaux par nom de fichier
  if (name === '.env' || name.startsWith('.env.')) {
    return <Settings size={size} color={orange} />;
  }
  if (name === '.gitignore') {
    return <ShieldCheck size={size} color={orange} />;
  }
  if (name === 'package.json' || name === 'package-lock.json') {
    return <FileJson size={size} color={orange} />;
  }
  if (name === 'tsconfig.json' || name === 'vite.config.ts' || name === 'tailwind.config.js') {
    return <Settings size={size} color={cyan} />;
  }
  if (name === 'README.md' || name.startsWith('README.')) {
    return <BookOpen size={size} color={doc} />;
  }

  const parts = name.split('.');
  const ext   = parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
  const Icon  = pickIcon(ext);
  const color = EXT_COLOR[ext] ?? 'var(--text-muted)';

  return <Icon size={size} color={color} />;
}
