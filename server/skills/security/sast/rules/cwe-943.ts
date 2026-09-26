import type { Rule } from '../../../../security/rules/Rule.js';

export const cwe943Rule: Rule = {
  id: 'CWE-943',
  name: 'NoSQL Injection',
  description: 'Requête NoSQL (MongoDB, DynamoDB...) vulnérable par passage direct d’objets de requête non assainis permettant le contournement de l’authentification ($ne, $gt...).',
  family: 'sast',
  severity: 'high',
  cwe: 'CWE-943',
  owasp: 'A03:2021-Injection',
  mitre: 'T1190',
  enabled: true,
  pattern: {
    regex: '(?:find|findOne|update|delete|count)\\s*\\(\\s*\\{\\s*[^}]*?\\$ne|req\\.body\\s*\\)\\s*;',
    regexFlags: 'i',
    extensions: ['.ts', '.js'],
    sources: ['req.body', 'req.query'],
    sinks: ['find', 'findOne', 'update', 'delete'],
  },
  remediation: 'Sanitisez les entrées avec express-mongo-sanitize ou vérifiez que les champs attendus sont des chaînes strictes (typeof === "string").',
  references: [
    'https://cwe.mitre.org/data/definitions/943.html',
    'https://owasp.org/Top10/A03_2021-Injection/',
  ],
};
