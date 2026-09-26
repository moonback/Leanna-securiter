import type { Rule } from '../../../../security/rules/Rule.js';

export const cwe78Rule: Rule = {
  id: 'CWE-78',
  name: 'OS Command Injection',
  description: 'Exécution de commandes système arbitraires via des arguments construits avec des entrées utilisateur sans validation ni quoting.',
  family: 'sast',
  severity: 'critical',
  cwe: 'CWE-78',
  owasp: 'A03:2021-Injection',
  mitre: 'T1059',
  enabled: true,
  pattern: {
    regex: '(?:exec|execSync|spawn|spawnSync)\\s*\\(\\s*[`\'"][^`\'"]*?\\$|child_process\\.(?:exec|execSync)\\s*\\(',
    regexFlags: 'i',
    extensions: ['.ts', '.js', '.py'],
    sources: ['req.body', 'req.query', 'req.params', 'args', 'argv'],
    sinks: ['exec', 'execSync', 'spawn', 'popen', 'system'],
  },
  remediation: 'Évitez les invocations shell (shell: false) et passez les arguments sous forme de tableau strict (execFile/spawn) plutôt que de chaîne interpolée.',
  references: [
    'https://cwe.mitre.org/data/definitions/78.html',
    'https://owasp.org/www-community/attacks/Command_Injection',
  ],
};
