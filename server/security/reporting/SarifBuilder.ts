import type { Finding, FindingSeverity } from "../findings/Finding.js";

/**
 * Générateur de rapport SARIF 2.1.0 (Static Analysis Results Interchange Format)
 * Conforme aux spécifications OASIS SARIF v2.1.0 et GitHub Code Scanning.
 */

function mapSeverityToSarifLevel(sev: FindingSeverity): 'error' | 'warning' | 'note' | 'none' {
  switch (sev) {
    case 'critical':
    case 'high':
      return 'error';
    case 'medium':
      return 'warning';
    case 'low':
      return 'note';
    case 'info':
    default:
      return 'none';
  }
}

export function buildSarifReport(findings: Finding[], workspaceRoot?: string): Record<string, unknown> {
  const rulesMap = new Map<string, any>();

  const results = findings.map((f) => {
    // Collecter les définitions de règles
    if (!rulesMap.has(f.ruleId)) {
      rulesMap.set(f.ruleId, {
        id: f.ruleId,
        name: f.ruleName,
        shortDescription: { text: f.title },
        fullDescription: { text: f.description },
        help: {
          text: f.remediation || f.description,
          markdown: `### Recommandation\n\n${f.remediation || 'Aucune recommandation.'}\n\n**Impact :** ${f.impact || 'N/A'}`,
        },
        properties: {
          tags: [...f.cwe, ...f.owasp, f.scanner],
          precision: 'high',
          'security-severity': String(f.cvssScore),
        },
      });
    }

    // Normaliser le chemin relatif
    let relPath = f.location.filePath.replace(/\\/g, '/');
    if (workspaceRoot) {
      const normRoot = workspaceRoot.replace(/\\/g, '/');
      if (relPath.startsWith(normRoot)) {
        relPath = relPath.slice(normRoot.length).replace(/^\//, '');
      }
    }

    const sarifResult: any = {
      ruleId: f.ruleId,
      level: mapSeverityToSarifLevel(f.severity),
      message: {
        text: `${f.title}: ${f.description}`,
      },
      locations: [
        {
          physicalLocation: {
            artifactLocation: {
              uri: relPath,
              uriBaseId: '%SRCROOT%',
            },
            region: {
              startLine: f.location.startLine,
              endLine: f.location.endLine || f.location.startLine,
              startColumn: f.location.startColumn || 1,
              endColumn: f.location.endColumn,
              snippet: f.location.snippet ? { text: f.location.snippet } : undefined,
            },
          },
        },
      ],
      partialFingerprints: {
        primaryLocationHash: f.fingerprint,
      },
    };

    // Taint Flow (Data Flow / Code Flow) si disponible
    if (f.taintFlow && f.taintFlow.length > 0) {
      sarifResult.codeFlows = [
        {
          threadFlows: [
            {
              locations: f.taintFlow.map((step) => ({
                location: {
                  physicalLocation: {
                    artifactLocation: { uri: step.filePath.replace(/\\/g, '/') },
                    region: { startLine: step.line },
                  },
                  message: { text: `[${step.kind.toUpperCase()}] ${step.description}` },
                },
                kinds: [step.kind],
              })),
            },
          ],
        },
      ];
    }

    return sarifResult;
  });

  return {
    $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'Leanna Security Auditor',
            semanticVersion: '1.2.0',
            informationUri: 'https://github.com/Leanna-security/leanna',
            rules: Array.from(rulesMap.values()),
          },
        },
        results,
        invocations: [
          {
            executionSuccessful: true,
            endTimeUtc: new Date().toISOString(),
          },
        ],
      },
    ],
  };
}
