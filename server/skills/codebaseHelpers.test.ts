import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import {
  buildTreeMarkdown,
  extractFileOutline,
  buildAnalysisPrompt,
  getProjectRoot,
  normalizeProjectPath,
  resolveWritePath,
  checkWorkspace
} from './codebaseHelpers.js';

test('codebaseHelpers: buildTreeMarkdown', () => {
  const files = [
    path.join('src', 'App.tsx'),
    path.join('src', 'components', 'Button.tsx'),
    'package.json',
  ];
  const markdown = buildTreeMarkdown(files);
  assert.match(markdown, /- package\.json/);
  assert.match(markdown, /- \*\*src\/\*\*/);
  assert.match(markdown, /- App\.tsx/);
  assert.match(markdown, /- \*\*components\/\*\*/);
  assert.match(markdown, /- Button\.tsx/);
});

test('codebaseHelpers: extractFileOutline for TS file', () => {
  const tsContent = [
    'import { useState } from "react";',
    'export interface Props {',
    '  title: string;',
    '}',
    'export class CustomButton extends React.Component {',
    '  render() {}',
    '}',
    'export function helperFunction() {}',
    'const myComponent = () => {};',
  ];
  const outline = extractFileOutline(tsContent, '.ts');
  const names = outline.map(o => o.name);
  assert.ok(names.includes('Props'));
  assert.ok(names.includes('CustomButton'));
  assert.ok(names.includes('helperFunction'));
});

test('codebaseHelpers: buildAnalysisPrompt', () => {
  const prompt = buildAnalysisPrompt('My codebase details');
  assert.match(prompt, /Analyse ce codebase/);
  assert.match(prompt, /Vue d'ensemble/);
  assert.match(prompt, /My codebase details/);
});

test('codebaseHelpers: workspace paths', () => {
  const projectRoot = getProjectRoot();
  assert.ok(typeof projectRoot === 'string');

  const normalized = normalizeProjectPath('package.json');
  assert.ok(normalized === null || typeof normalized === 'string');

  const writePath = resolveWritePath('newfile.txt');
  assert.ok(writePath === null || typeof writePath === 'string');

  const workspaceStatus = checkWorkspace();
  assert.ok(typeof workspaceStatus.exists === 'boolean');
  assert.ok(typeof workspaceStatus.path === 'string');
});
