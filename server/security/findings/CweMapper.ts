export interface CweInfo {
  id: string;
  name: string;
  description: string;
  owaspTop10_2021: string;
  defaultSeverity: 'critical' | 'high' | 'medium' | 'low';
  defaultCvssScore: number;
}

export const KNOWN_CWES: Record<string, CweInfo> = {
  'CWE-79': {
    id: 'CWE-79',
    name: 'Improper Neutralization of Input During Web Page Generation (XSS)',
    description: 'Le logiciel insère des données non fiables dans une page Web sans encodage approprié, permettant l\'exécution de scripts malveillants.',
    owaspTop10_2021: 'A03:2021-Injection',
    defaultSeverity: 'high',
    defaultCvssScore: 7.5,
  },
  'CWE-89': {
    id: 'CWE-89',
    name: 'Improper Neutralization of Special Elements used in an SQL Command (SQLi)',
    description: 'Le logiciel construit une commande SQL à l\'aide d\'entrées non assainies, permettant la modification de la logique de la requête.',
    owaspTop10_2021: 'A03:2021-Injection',
    defaultSeverity: 'critical',
    defaultCvssScore: 9.8,
  },
  'CWE-78': {
    id: 'CWE-78',
    name: 'Improper Neutralization of Special Elements used in an OS Command (Command Injection)',
    description: 'Le logiciel construit une commande système à exécuter à partir de données non fiables sans validation.',
    owaspTop10_2021: 'A03:2021-Injection',
    defaultSeverity: 'critical',
    defaultCvssScore: 9.8,
  },
  'CWE-22': {
    id: 'CWE-22',
    name: 'Improper Limitation of a Pathname to a Restricted Directory (Path Traversal)',
    description: 'Le logiciel utilise des données externes pour construire un chemin d\'accès à un fichier sans neutraliser les séquences ../.',
    owaspTop10_2021: 'A01:2021-Broken Access Control',
    defaultSeverity: 'high',
    defaultCvssScore: 8.6,
  },
  'CWE-918': {
    id: 'CWE-918',
    name: 'Server-Side Request Forgery (SSRF)',
    description: 'Le serveur Web récupère une ressource distante en utilisant une URL fournie par l\'utilisateur sans validation d\'adresse IP interne.',
    owaspTop10_2021: 'A10:2021-Server-Side Request Forgery (SSRF)',
    defaultSeverity: 'high',
    defaultCvssScore: 8.6,
  },
  'CWE-502': {
    id: 'CWE-502',
    name: 'Deserialization of Untrusted Data',
    description: 'La désérialisation de données non approuvées peut entraîner l\'exécution de code arbitraire ou le déni de service.',
    owaspTop10_2021: 'A08:2021-Software and Data Integrity Failures',
    defaultSeverity: 'critical',
    defaultCvssScore: 9.8,
  },
  'CWE-798': {
    id: 'CWE-798',
    name: 'Use of Hard-coded Credentials',
    description: 'Le code source contient des clés, jetons ou mots de passe codés en dur.',
    owaspTop10_2021: 'A07:2021-Identification and Authentication Failures',
    defaultSeverity: 'critical',
    defaultCvssScore: 9.1,
  },
  'CWE-327': {
    id: 'CWE-327',
    name: 'Use of a Broken or Risky Cryptographic Algorithm',
    description: 'Utilisation d\'algorithmes cryptographiques obsolètes ou affaiblis (MD5, SHA1, DES, ECB mode).',
    owaspTop10_2021: 'A02:2021-Cryptographic Failures',
    defaultSeverity: 'medium',
    defaultCvssScore: 5.9,
  },
  'CWE-1321': {
    id: 'CWE-1321',
    name: 'Improperly Controlled Modification of Object Prototype Attributes (Prototype Pollution)',
    description: 'La fusion récursive ou modification de propriétés d\'objets JavaScript modifie Object.prototype globalement.',
    owaspTop10_2021: 'A03:2021-Injection',
    defaultSeverity: 'high',
    defaultCvssScore: 7.5,
  },
  'CWE-94': {
    id: 'CWE-94',
    name: 'Improper Control of Generation of Code (Code Injection)',
    description: 'Utilisation dangereuse d\'eval(), Function(), vm.runInContext() avec des entrées utilisateur.',
    owaspTop10_2021: 'A03:2021-Injection',
    defaultSeverity: 'critical',
    defaultCvssScore: 9.8,
  },
};

export function getCweDetails(cweId: string): CweInfo {
  const norm = cweId.toUpperCase().trim();
  if (KNOWN_CWES[norm]) {
    return KNOWN_CWES[norm];
  }
  return {
    id: norm,
    name: `Common Weakness Enumeration ${norm}`,
    description: 'Faiblesse de sécurité répertoriée dans la base CWE/MITRE.',
    owaspTop10_2021: 'A03:2021-Injection',
    defaultSeverity: 'medium',
    defaultCvssScore: 5.0,
  };
}
