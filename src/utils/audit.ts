export type AuditStepStatus = 'pending' | 'running' | 'done' | 'error';

export interface AuditStep {
  id: string;
  title: string;
  detail: string;
  status: AuditStepStatus;
  value?: string;        // metric to display (ex: "16 GB", "8 cores")
  timestamp?: number;    // ms since epoch when step completed
}

export interface AuditReport {
  platform: string;
  release: string;
  arch: string;
  cpus: number;
  totalMemoryMB: number;
  freeMemoryMB: number;
  uptimeHours: number;
  nodeVersion: string;
  activeSkills: string[];
  supabaseOk: boolean;
  geminiOk: boolean;
  openrouterOk: boolean;
  telegramOk: boolean;
  telegramConfigured: boolean;
  mcpOk: boolean;
  mcpConnected: number;
  mcpTotal: number;
  projectRoot: string;
  generatedAt: string;
}

export function isSystemAuditRequest(text: string): boolean {
  const n = text.toLowerCase();
  return (
    (n.includes('audit') && (n.includes('system') || n.includes('système') || n.includes('sys'))) ||
    n.includes('état du système') ||
    n.includes('etat du systeme') ||
    n.includes('diagnostic système') ||
    n.includes('diagnostic systeme')
  );
}

export function isOpenRouterRequest(text: string): boolean {
  const n = text.toLowerCase();
  return (
    n.includes('openrouter') ||
    (n.includes('open') && n.includes('router')) ||
    n.includes('open router')
  );
}

export function buildAuditSteps(): AuditStep[] {
  return [
    {
      id: 'os',
      title: 'Système d\'exploitation',
      detail: 'Détection de la plateforme, architecture et version',
      status: 'pending',
    },
    {
      id: 'resources',
      title: 'Ressources matérielles',
      detail: 'CPU, RAM disponible et uptime',
      status: 'pending',
    },
    {
      id: 'services',
      title: 'Services & API',
      detail: 'Vérification Gemini, Supabase, OpenRouter',
      status: 'pending',
    },
    {
      id: 'skills',
      title: 'Skills actifs',
      detail: 'Inventaire des modules chargés',
      status: 'pending',
    },
    {
      id: 'summary',
      title: 'Résumé de sécurité',
      detail: 'Synthèse et score de santé du système',
      status: 'pending',
    },
  ];
}
