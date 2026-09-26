import test from 'node:test';
import assert from 'node:assert/strict';
import { graphifySkill, getGraphifyBinaryPath, getGraphifyCwd } from './graphify.js';

test('graphifySkill: structure et métadonnées', () => {
  assert.equal(graphifySkill.name, 'graphify');
  assert.ok(Array.isArray(graphifySkill.declarations));
  assert.equal(graphifySkill.declarations.length, 7);

  const toolNames = graphifySkill.declarations.map(d => d.name);
  assert.ok(toolNames.includes('graphify_query'));
  assert.ok(toolNames.includes('graphify_path'));
  assert.ok(toolNames.includes('graphify_explain'));
  assert.ok(toolNames.includes('graphify_affected'));
  assert.ok(toolNames.includes('graphify_god_nodes'));
  assert.ok(toolNames.includes('graphify_read_report'));
  assert.ok(toolNames.includes('graphify_update'));
});

test('graphifySkill: résolution du binaire et du cwd', () => {
  const bin = getGraphifyBinaryPath();
  assert.ok(bin.length > 0);
  const cwd = getGraphifyCwd();
  assert.ok(cwd.length > 0);
});

test('graphifySkill: graphify_read_report', async () => {
  const result: any = await graphifySkill.handleToolCall('graphify_read_report', { section: 'summary' });
  assert.equal(result.status, 'success');
  assert.equal(result.section, 'summary');
  assert.ok(result.content.includes('Graph Report'));
});

test('graphifySkill: graphify_god_nodes', async () => {
  const result: any = await graphifySkill.handleToolCall('graphify_god_nodes', { top: 3 });
  assert.equal(result.status, 'success');
  assert.ok(result.hubs.length > 0);
});

test('graphifySkill: graphify_query', async () => {
  const result: any = await graphifySkill.handleToolCall('graphify_query', { question: 'runtime agent' });
  assert.equal(result.status, 'success');
  assert.ok(result.graphContext.length > 0);
});
