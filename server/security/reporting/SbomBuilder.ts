import crypto from "crypto";

export interface SbomComponent {
  name: string;
  version: string;
  purl?: string;
  type?: 'library' | 'framework' | 'application';
  licenses?: string[];
  vulnerabilities?: Array<{
    id: string;
    severity: string;
    description: string;
  }>;
}

export function buildCycloneDxSbom(params: {
  projectName: string;
  projectVersion: string;
  components: SbomComponent[];
}): Record<string, unknown> {
  const serialNumber = `urn:uuid:${crypto.randomUUID()}`;

  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    serialNumber,
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      tools: [
        {
          vendor: 'Leanna Security',
          name: 'Leanna SBOM Builder',
          version: '1.2.0',
        },
      ],
      component: {
        type: 'application',
        name: params.projectName || 'target-application',
        version: params.projectVersion || '1.0.0',
      },
    },
    components: params.components.map((c) => ({
      type: c.type || 'library',
      name: c.name,
      version: c.version,
      purl: c.purl || `pkg:npm/${c.name}@${c.version}`,
      licenses: c.licenses?.map((lic) => ({ license: { id: lic } })) || [],
      vulnerabilities: c.vulnerabilities?.map((v) => ({
        id: v.id,
        ratings: [
          {
            severity: v.severity,
          },
        ],
        description: v.description,
      })),
    })),
  };
}
