import type { Rule } from '../../../../security/rules/Rule.js';

export const cwe918Rule: Rule = {
  id: 'CWE-918',
  name: 'Server-Side Request Forgery (SSRF)',
  description: 'Requête réseau initiée par le serveur vers une URL contrôlée par un utilisateur sans validation de l’hôte ni blocage des plages privées RFC 1918.',
  family: 'sast',
  severity: 'high',
  cwe: 'CWE-918',
  owasp: 'A10:2021-Server-Side Request Forgery',
  mitre: 'T1190',
  enabled: true,
  pattern: {
    regex: '(?:fetch|axios(?:\\.get|\\.post)?|http\\.get|https\\.get|request)\\s*\\(\\s*(?:req\\.|url|targetUrl|input)',
    regexFlags: 'i',
    extensions: ['.ts', '.js', '.py'],
    sources: ['req.body.url', 'req.query.url', 'req.params', 'url'],
    sinks: ['fetch', 'axios', 'http.get', 'https.get', 'request'],
  },
  remediation: 'Implémentez une liste blanche stricte de domaines autorisés et refusez toute résolution vers 127.0.0.1, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16 ou les métadonnées cloud (169.254.169.254).',
  references: [
    'https://cwe.mitre.org/data/definitions/918.html',
    'https://owasp.org/Top10/A10_2021-Server-Side_Request_Forgery_%28SSRF%29/',
  ],
};
