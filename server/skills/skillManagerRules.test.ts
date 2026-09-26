import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'url';
import path from 'path';
import { setSelfRoot } from '../utils/selfRoot.js';
import { ERROR_PATTERNS } from './skillManagerRules.js';

// Set SELF_ROOT so path resolution in ERROR_PATTERNS fixes works correctly
{
  const __filename = fileURLToPath(import.meta.url);
  // server/skills/ → ../.. = project root
  setSelfRoot(path.resolve(path.dirname(__filename), '..', '..'));
}

test('skillManagerRules: missing-property pattern', () => {
  const pattern = ERROR_PATTERNS.find(p => p.id === 'missing-property');
  assert.ok(pattern);

  const error = new Error("Property 'foo' does not exist on type 'Props'");
  assert.equal(pattern.match(error, 'interface Props {}'), true);

  const mockContent = 'export interface Props {\n  title: string;\n}';
  const fixed = pattern.fix(error, mockContent);
  assert.match(fixed!, /foo\?: any; \/\/ \[auto-heal\]/);
});

test('skillManagerRules: missing-import pattern', () => {
  const pattern = ERROR_PATTERNS.find(p => p.id === 'missing-import');
  assert.ok(pattern);

  // 1. Unresolved fallback
  const error1 = new Error("Cannot find name 'MyHelper'");
  assert.equal(pattern.match(error1, 'const a = MyHelper();'), true);
  const fixed1 = pattern.fix(error1, 'const a = MyHelper();');
  assert.match(fixed1!, /Import manquant détecté: MyHelper/);

  // 2. Known import resolution
  const error2 = new Error("Cannot find name 'fs'");
  const fixed2 = pattern.fix(error2, 'const read = fs.readFileSync("a");');
  assert.match(fixed2!, /import fs from "fs";/);

  // 3. Workspace export resolution
  const error3 = new Error("Cannot find name 'ERROR_PATTERNS'");
  const fixed3 = pattern.fix(error3, 'console.log(ERROR_PATTERNS);', 'server/skills/agents.ts');
  assert.match(fixed3!, /import \{ ERROR_PATTERNS \} from "\.\/skillManagerRules";/);
});

test('skillManagerRules: undefined-access pattern', () => {
  const pattern = ERROR_PATTERNS.find(p => p.id === 'undefined-access');
  assert.ok(pattern);

  const error = new Error("Object is possibly 'undefined' (at line (3,10))");
  assert.equal(pattern.match(error, 'line1\nline2\nline3'), true);

  const fixed = pattern.fix(error, 'line1\nline2\nline3');
  assert.match(fixed!, /line3 \/\/ \[auto-heal\] TODO: vérifier null\/undefined/);
});

test('skillManagerRules: unused-variable pattern', () => {
  const pattern = ERROR_PATTERNS.find(p => p.id === 'unused-variable');
  assert.ok(pattern);

  const error = new Error("'myUnused' is declared but its value is never read");
  assert.equal(pattern.match(error, 'const myUnused = 10;'), true);

  const fixed = pattern.fix(error, 'const myUnused = 10;');
  assert.match(fixed!, /_myUnused/);
});
