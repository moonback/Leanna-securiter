import type { Rule } from '../../../../security/rules/Rule.js';

export const cwe89Rule: Rule = {
  id: 'CWE-89',
  name: 'SQL Injection',
  description: 'Construction non sécurisée de requêtes SQL par concaténation ou interpolation de variables utilisateur sans paramétrage.',
  family: 'sast',
  severity: 'critical',
  cwe: 'CWE-89',
  owasp: 'A03:2021-Injection',
  mitre: 'T1190',
  enabled: true,
  pattern: {
    regex: '(?:SELECT|INSERT|UPDATE|DELETE|FROM|WHERE)\\s+.*?\\$\\{|(?:db|sequelize|knex|prisma|client)\\.query\\s*\\(\\s*[`\'"][^`\'"]*?\\+|execute\\s*\\(\\s*[`\'"][^`\'"]*?\\+',
    regexFlags: 'i',
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.py', '.php'],
    sources: ['req.body', 'req.query', 'req.params', 'request.args', 'input'],
    sinks: ['query', 'execute', 'raw', 'rawQuery', 'queryRaw'],
  },
  remediation: 'Utilisez systématiquement des requêtes paramétrées avec placeholders ($1, ?, :param) ou un ORM sécurisé.',
  references: [
    'https://cwe.mitre.org/data/definitions/89.html',
    'https://owasp.org/Top10/A03_2021-Injection/',
  ],
};
