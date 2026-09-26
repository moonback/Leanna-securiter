import test from 'node:test';
import assert from 'node:assert/strict';
import { exportToDocx } from './docxExporter.js';

test('docxExporter: converts markdown into a Word-compatible binary buffer', () => {
  const md = '# Spécification Technique\n\nIntroduction du document.\n\n| Colonne 1 | Colonne 2 |\n|---|---|\n| Valeur A | Valeur B |\n';
  const buffer = exportToDocx(md, {
    title: 'Spécification Technique',
    author: 'Equipe Leanna',
  });

  assert.ok(Buffer.isBuffer(buffer));
  assert.ok(buffer.length > 100);

  const text = buffer.toString('utf-8');
  assert.ok(text.includes('urn:schemas-microsoft-com:office:word'));
  assert.ok(text.includes('Spécification Technique'));
  assert.ok(text.includes('Valeur A'));
});
