import test from 'node:test';
import assert from 'node:assert/strict';
import { exportToStandaloneHtml } from './htmlExporter.js';

test('htmlExporter: converts markdown into a full standalone HTML document', () => {
  const md = '# Titre Principal\n\nCeci est un paragraphe avec du **gras** et du *italique*.\n\n- Puce 1\n- Puce 2\n\n```typescript\nconst x = 42;\n```';
  const html = exportToStandaloneHtml(md, {
    title: 'Mon Rapport',
    author: 'Leanna',
    theme: 'modern',
  });

  assert.ok(html.includes('<!DOCTYPE html>'));
  assert.ok(html.includes('<title>Mon Rapport</title>'));
  assert.ok(html.includes('<h1>Titre Principal</h1>'));
  assert.ok(html.includes('const x = 42;'));
  assert.ok(html.includes('Auteur : Leanna'));
});

test('htmlExporter: applies dark theme styling', () => {
  const md = '## Section Sombre';
  const html = exportToStandaloneHtml(md, { theme: 'dark' });

  assert.ok(html.includes('data-theme="dark"'));
  assert.ok(html.includes('--bg: #0f172a'));
});
