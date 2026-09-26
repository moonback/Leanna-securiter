import type { Rule } from '../../../../security/rules/Rule.js';

export const cwe502Rule: Rule = {
  id: 'CWE-502',
  name: 'Deserialization of Untrusted Data',
  description: 'Désérialisation non sécurisée d’objets ou données non fiables pouvant entraîner l’instanciation de classes malveillantes ou l’exécution de code arbitraire.',
  family: 'sast',
  severity: 'critical',
  cwe: 'CWE-502',
  owasp: 'A08:2021-Software and Data Integrity Failures',
  mitre: 'T1505',
  enabled: true,
  pattern: {
    regex: '(?:yaml\\.load|serialize\\.unserialize|node-serialize|pickle\\.loads|unflatten)\\s*\\(',
    regexFlags: 'i',
    extensions: ['.ts', '.js', '.py'],
    sources: ['req.body', 'payload', 'data'],
    sinks: ['yaml.load', 'unserialize', 'pickle.loads'],
  },
  remediation: 'Utilisez des formats de sérialisation sécurisés stricts comme JSON.parse() ou yaml.safeLoad() / schema JSON Zod sans exécution dynamique.',
  references: [
    'https://cwe.mitre.org/data/definitions/502.html',
    'https://owasp.org/Top10/A08_2021-Software_and_Data_Integrity_Failures/',
  ],
};
