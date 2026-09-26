import test from 'node:test';
import assert from 'node:assert/strict';
import { weatherSkill } from './weather.js';

test('weatherSkill: metadata', () => {
  assert.equal(weatherSkill.name, 'weather');
  const declNames = weatherSkill.declarations.map((d: any) => d.name);
  assert.ok(declNames.includes('get_weather'));
});
