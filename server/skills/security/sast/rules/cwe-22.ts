import type { Rule } from '../../../../security/rules/Rule.js';

export const cwe22Rule: Rule = {
  id: 'CWE-22',
  name: 'Path Traversal',
  description: 'Accès non autorisé à des fichiers situés en dehors du répertoire prévu via l’utilisation de séquences relatives (../) non neutralisées.',
  family: 'sast',
  severity: 'high',
  cwe: 'CWE-22',
  owasp: 'A01:2021-Broken Access Control',
  mitre: 'T1083',
  enabled: true,
  pattern: {
    regex: '(?:fs\\.readFile|fs\\.readFileSync|fs\\.createReadStream|res\\.sendFile)\\s*\\(\\s*(?:path\\.join|path\\.resolve)?\\s*\\([^)]*?(?:req\\.|input|filename)',
    regexFlags: 'i',
    extensions: ['.ts', '.js', '.py'],
    sources: ['req.params', 'req.query', 'filename', 'filePath'],
    sinks: ['readFile', 'readFileSync', 'createReadStream', 'sendFile', 'open'],
  },
  remediation: 'Validez le chemin avec path.resolve et vérifiez systématiquement que le chemin résolu commence par le préfixe du dossier racine autorisé (startsWith).',
  references: [
    'https://cwe.mitre.org/data/definitions/22.html',
    'https://owasp.org/www-community/attacks/Path_Traversal',
  ],
};
