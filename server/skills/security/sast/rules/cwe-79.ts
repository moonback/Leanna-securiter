import type { Rule } from '../../../../security/rules/Rule.js';

export const cwe79Rule: Rule = {
  id: 'CWE-79',
  name: 'Cross-Site Scripting (XSS)',
  description: 'Injection de code HTML ou JavaScript arbitraire exécuté dans le navigateur de la victime par manque d’échappement ou sanitisation.',
  family: 'sast',
  severity: 'high',
  cwe: 'CWE-79',
  owasp: 'A03:2021-Injection',
  mitre: 'T1189',
  enabled: true,
  pattern: {
    regex: 'dangerouslySetInnerHTML\\s*=\\s*\\{\\s*\\{\\s*__html|innerHTML\\s*=|outerHTML\\s*=|document\\.write\\s*\\(|\\$\\s*\\([^)]*?\\)\\.html\\s*\\(',
    regexFlags: 'i',
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.html'],
    sources: ['req.query', 'req.params', 'location.search', 'location.hash', 'window.name'],
    sinks: ['innerHTML', 'dangerouslySetInnerHTML', 'document.write', 'html'],
  },
  remediation: 'Utilisez textContent ou les bindings JSX natifs auto-échappés, ou purifiez avec DOMPurify avant injection.',
  references: [
    'https://cwe.mitre.org/data/definitions/79.html',
    'https://owasp.org/www-community/attacks/xss/',
  ],
};
