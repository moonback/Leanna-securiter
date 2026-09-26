import crypto from "crypto";
import path from "path";
import type { Finding, TaintFlowStep } from "../findings/Finding.js";
import { computeFingerprint } from "../findings/Fingerprint.js";

interface TaintSinkDefinition {
  ruleId: string;
  ruleName: string;
  cwe: string[];
  owasp: string[];
  severity: 'critical' | 'high' | 'medium';
  cvssScore: number;
  pattern: RegExp;
  sinkKind: string;
  description: string;
  impact: string;
  remediation: string;
}

const TAINT_SINKS: TaintSinkDefinition[] = [
  {
    ruleId: 'SAST-SQLI',
    ruleName: 'Injection SQL (Concaténation dynamique de requête)',
    cwe: ['CWE-89'],
    owasp: ['A03:2021-Injection'],
    severity: 'critical',
    cvssScore: 9.8,
    pattern: /(?:(?:db|pool|client|connection|sequelize)\s*\.\s*(?:query|execute|raw)|SELECT\s+.*FROM|INSERT\s+INTO|UPDATE\s+.*SET|DELETE\s+FROM)\s*\(?.*(?:\+|\$\{)/i,
    sinkKind: 'SQL Query Sink',
    description: 'Une requête SQL est construite par concaténation de chaînes avec des variables d\'entrée non assainies.',
    impact: 'Exfiltration de base de données, contournement de l\'authentification, altération ou suppression destructive de données.',
    remediation: 'Utilisez des requêtes préparées avec des paramètres liés ($1, $2 ou ?) au lieu de la concaténation de chaînes.',
  },
  {
    ruleId: 'SAST-CMD-INJECTION',
    ruleName: 'Injection de commande système (OS Command Injection)',
    cwe: ['CWE-78', 'CWE-88'],
    owasp: ['A03:2021-Injection'],
    severity: 'critical',
    cvssScore: 9.8,
    pattern: /(?:exec|execSync|spawn|spawnSync|execFile)\s*\(.*?(?:\$\{|\+)/i,
    sinkKind: 'Command Execution Sink',
    description: 'Exécution d\'une commande système via le shell avec des paramètres utilisateur non filtrés.',
    impact: 'Prise de contrôle complète du serveur hôte, exécution de code arbitraire avec les privilèges du processus Leanna/Node.',
    remediation: 'Évitez exec() avec un interpréteur shell. Utilisez execFile() avec un tableau d\'arguments stricts ou validez par liste blanche.',
  },
  {
    ruleId: 'SAST-PATH-TRAVERSAL',
    ruleName: 'Traversée de répertoire (Path Traversal / LFI)',
    cwe: ['CWE-22'],
    owasp: ['A01:2021-Broken Access Control'],
    severity: 'high',
    cvssScore: 8.6,
    pattern: /(?:fs\s*\.\s*(?:readFile|readFileSync|createReadStream|writeFile|writeFileSync|unlink)|path\s*\.\s*(?:join|resolve))\s*\(.*?(?:req\.|params\.|query\.|body\.)/i,
    sinkKind: 'Filesystem Access Sink',
    description: 'Le chemin d\'accès à un fichier du système de fichiers est dérivé directement d\'une entrée utilisateur sans restriction de répertoire canonique.',
    impact: 'Lecture ou écriture de fichiers arbitraires sur le système (ex: /etc/passwd, .env, clés SSH).',
    remediation: 'Validez le chemin avec path.resolve() et assurez-vous qu\'il commence strictement par le répertoire racine autorisé (fail-closed).',
  },
  {
    ruleId: 'SAST-CODE-EVAL',
    ruleName: 'Exécution dynamique de code (Eval / Code Injection)',
    cwe: ['CWE-94', 'CWE-95'],
    owasp: ['A03:2021-Injection'],
    severity: 'critical',
    cvssScore: 9.8,
    pattern: /(?:\beval\s*\(|new\s+Function\s*\(|vm\s*\.\s*runIn(?:ThisContext|NewContext|Context)\s*\()/i,
    sinkKind: 'Dynamic Code Evaluation Sink',
    description: 'Utilisation de eval() ou Function() pour exécuter dynamiquement des chaînes de caractères potentiellement contrôlées par un utilisateur.',
    impact: 'Exécution de code distant (RCE) immédiate dans le contexte du processus.',
    remediation: 'Supprimez tout recours à eval() ou new Function(). Utilisez des parseurs structurés (ex: JSON.parse) ou des machines d\'état.',
  },
  {
    ruleId: 'SAST-SSRF',
    ruleName: 'Server-Side Request Forgery (SSRF)',
    cwe: ['CWE-918'],
    owasp: ['A10:2021-Server-Side Request Forgery (SSRF)'],
    severity: 'high',
    cvssScore: 8.6,
    pattern: /(?:fetch|axios\s*\.\s*(?:get|post|request)|http\s*\.\s*get|https\s*\.\s*request)\s*\(\s*(?:req\.|params\.|query\.|body\.|url\b)/i,
    sinkKind: 'HTTP Request Sink',
    description: 'Le serveur effectue une requête HTTP sortante vers une URL fournie par l\'utilisateur sans validation d\'adresse IP privée (RFC 1918 / localhost / métadonnées cloud).',
    impact: 'Accès aux services internes du réseau local, exfiltration des métadonnées cloud (169.254.169.254 AWS/GCP).',
    remediation: 'Implémentez une liste blanche stricte des domaines autorisés et interdisez la résolution vers les plages IP privées et loopback.',
  },
  {
    ruleId: 'SAST-XSS-REFLECTED',
    ruleName: 'Cross-Site Scripting réfléchi (DOM / HTML Injection)',
    cwe: ['CWE-79'],
    owasp: ['A03:2021-Injection'],
    severity: 'high',
    cvssScore: 7.5,
    pattern: /(?:dangerouslySetInnerHTML|innerHTML\s*=|res\s*\.\s*send\s*\(.*?(?:<|\+)|document\s*\.\s*write\s*\()/i,
    sinkKind: 'DOM / HTML Rendering Sink',
    description: 'Données non échappées injectées dans le DOM ou la réponse HTML du serveur web.',
    impact: 'Vol de cookies de session, détournement de compte utilisateur, défaçage.',
    remediation: 'Utilisez textContent au lieu de innerHTML, ou nettoyez avec DOMPurify / sanitizers automatiques.',
  },
];

// Sources de données utilisateur non fiables
const TAINT_SOURCES = [
  { name: 'req.query', pattern: /req\.query(?:\.([a-zA-Z0-9_]+)|\[['"](.*?)['"]\])?/i },
  { name: 'req.body', pattern: /req\.body(?:\.([a-zA-Z0-9_]+)|\[['"](.*?)['"]\])?/i },
  { name: 'req.params', pattern: /req\.params(?:\.([a-zA-Z0-9_]+)|\[['"](.*?)['"]\])?/i },
  { name: 'req.headers', pattern: /req\.headers(?:\.([a-zA-Z0-9_]+)|\[['"](.*?)['"]\])?/i },
  { name: 'window.location.search', pattern: /(?:window\.)?location\.(?:search|hash)/i },
  { name: 'process.argv', pattern: /process\.argv/i },
];

export async function analyzeFileTaint(filePath: string, content: string): Promise<Finding[]> {
  const findings: Finding[] = [];
  const lines = content.split(/\r?\n/);

  // Cartographie des variables teintées dans ce fichier : variableName -> { line, sourceDescription }
  const taintedVariables = new Map<string, { line: number; sourceDesc: string }>();

  // 1ère passe : Détecter l'introduction des sources de taint et propagations
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    const lineNum = idx + 1;

    // Détection d'assignation depuis une source : const x = req.query.foo;
    for (const source of TAINT_SOURCES) {
      if (source.pattern.test(line)) {
        // Extraire la variable assignée : (const|let|var) varName = ...
        const assignMatch = line.match(/(?:const|let|var)\s+([a-zA-Z0-9_]+)\s*=\s*/);
        if (assignMatch) {
          const varName = assignMatch[1];
          taintedVariables.set(varName, {
            line: lineNum,
            sourceDesc: `Entrée non fiable reçue via ${source.name}`,
          });
        }
      }
    }

    // Détection de propagation : const y = "prefix " + x;
    for (const [tVar, info] of taintedVariables.entries()) {
      const propRegex = new RegExp(`(?:const|let|var)\\s+([a-zA-Z0-9_]+)\\s*=.*\\b${tVar}\\b`);
      const propMatch = line.match(propRegex);
      if (propMatch && propMatch[1] !== tVar) {
        taintedVariables.set(propMatch[1], {
          line: lineNum,
          sourceDesc: `Propagation de la variable teintée "${tVar}"`,
        });
      }
    }
  }

  // 2ème passe : Détecter si une variable teintée ou une source directe atteint un Sink
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    const lineNum = idx + 1;

    // Ignorer les commentaires
    if (/^\s*(?:\/\/|\/\*|\*)/.test(line)) continue;

    for (const sink of TAINT_SINKS) {
      if (sink.pattern.test(line)) {
        // Vérifier si une source directe ou une variable teintée est présente dans cette ligne de sink
        let matchedTaint: { varName: string; line: number; sourceDesc: string } | null = null;

        for (const [tVar, info] of taintedVariables.entries()) {
          const varUseRegex = new RegExp(`\\b${tVar}\\b`);
          if (varUseRegex.test(line)) {
            matchedTaint = { varName: tVar, ...info };
            break;
          }
        }

        const directSource = TAINT_SOURCES.find((s) => s.pattern.test(line));

        if (matchedTaint || directSource) {
          const taintFlow: TaintFlowStep[] = [];

          if (matchedTaint) {
            taintFlow.push({
              step: 1,
              filePath,
              line: matchedTaint.line,
              kind: 'source',
              description: matchedTaint.sourceDesc,
              variableName: matchedTaint.varName,
            });
            if (matchedTaint.line !== lineNum) {
              taintFlow.push({
                step: 2,
                filePath,
                line: lineNum,
                kind: 'sink',
                description: `Flux de données teinté consommé par ${sink.sinkKind} ("${matchedTaint.varName}")`,
                variableName: matchedTaint.varName,
              });
            }
          } else if (directSource) {
            taintFlow.push({
              step: 1,
              filePath,
              line: lineNum,
              kind: 'source',
              description: `Source directe non filtrée (${directSource.name})`,
            });
            taintFlow.push({
              step: 2,
              filePath,
              line: lineNum,
              kind: 'sink',
              description: `Atteint directement le sink critique ${sink.sinkKind}`,
            });
          }

          const fingerprint = computeFingerprint({
            filePath,
            ruleId: sink.ruleId,
            snippet: line.trim(),
            startLine: lineNum,
          });

          findings.push({
            id: crypto.randomUUID(),
            fingerprint,
            ruleId: sink.ruleId,
            ruleName: sink.ruleName,
            title: `${sink.ruleName} dans ${path.basename(filePath)}:${lineNum}`,
            description: sink.description,
            severity: sink.severity,
            status: 'open',
            scanner: 'sast',
            cwe: sink.cwe,
            owasp: sink.owasp,
            location: {
              filePath,
              startLine: lineNum,
              snippet: line.trim(),
            },
            cvssScore: sink.cvssScore,
            taintFlow,
            impact: sink.impact,
            remediation: sink.remediation,
            firstSeen: new Date().toISOString(),
            lastSeen: new Date().toISOString(),
          });
        }
      }
    }
  }

  return findings;
}
