import { Router, Request, Response } from 'express';

// ─── Metadata pour les skills intégrés ─────────────────────────────────────────

interface SkillMeta {
  name: string;
  icon: string;
  description: string;
  category: string;
}

const BUILTIN_SKILL_META: Record<string, SkillMeta> = {
  time: {
    name: 'Time & Date',
    icon: 'Clock',
    description: 'Gestion et consultation de la date et de l\'heure système',
    category: 'system',
  },
  weather: {
    name: 'Weather',
    icon: 'CloudRain',
    description: 'Consultation météo et prévisions en direct',
    category: 'web',
  },
  github: {
    name: 'GitHub',
    icon: 'Github',
    description: 'Gestion des dépôts, issues, pull requests et notifications GitHub',
    category: 'git',
  },
  list: {
    name: 'Lists',
    icon: 'List',
    description: 'Gestion de listes de tâches, notes et mémos dynamiques',
    category: 'productivity',
  },
  memory: {
    name: 'Long-term Memory (Supabase)',
    icon: 'Database',
    description: 'Mémoire sémantique à long terme persistée sur Supabase',
    category: 'data',
  },
  automation: {
    name: 'Automation (Puppeteer)',
    icon: 'Globe',
    description: 'Automatisation web, navigation headless, capture et interaction',
    category: 'automation',
  },
  system: {
    name: 'OS Control (Electron/Node)',
    icon: 'Monitor',
    description: 'Contrôle du système d\'exploitation, exécution de commandes et notifications',
    category: 'system',
  },
  reasoning: {
    name: 'Background Tasks (Gemini Pro)',
    icon: 'Blocks',
    description: 'Délégation de tâches complexes de réflexion et d\'analyse en arrière-plan',
    category: 'ai',
  },
  codebase: {
    name: 'Codebase Editor',
    icon: 'Code',
    description: 'Exploration, lecture, écriture, patch et analyse de code source',
    category: 'code',
  },
  security_audit: {
    name: 'Autonomous Security Audit',
    icon: 'ShieldCheck',
    description: 'Audit de sécurité autonome du code, scan de vulnérabilités et dépendances',
    category: 'security',
  },
  history: {
    name: 'Conversation History (Supabase)',
    icon: 'History',
    description: 'Historique des conversations et contexte conversationnel',
    category: 'data',
  },
  verify: {
    name: 'Verify & Validation',
    icon: 'CheckCircle2',
    description: 'Vérification de code, typecheck TypeScript, linting et tests',
    category: 'code',
  },
  project: {
    name: 'Project Intelligence',
    icon: 'FolderTree',
    description: 'Compréhension du projet, indexation et graphe de dépendances',
    category: 'code',
  },
  agents: {
    name: 'Agent Multi-Orchestration',
    icon: 'Bot',
    description: 'Orchestration d\'agents spécialisés et coordination multi-rôles',
    category: 'ai',
  },
  mission: {
    name: 'Autonomous Missions',
    icon: 'Crosshair',
    description: 'Planification et exécution de missions complexes avec auto-évaluation',
    category: 'ai',
  },
  graphify: {
    name: 'Graphify Knowledge',
    icon: 'GitBranch',
    description: 'Graphe de connaissances visuel du code et relations structurelles',
    category: 'data',
  },
  richDocument: {
    name: 'Rich Documents',
    icon: 'FileText',
    description: 'Génération de documents riches (Markdown, HTML, PDF/Docx)',
    category: 'productivity',
  },
  documentKnowledge: {
    name: 'Document Knowledge',
    icon: 'BookOpen',
    description: 'Analyse et indexation des documents du workspace',
    category: 'data',
  },
  documentLinker: {
    name: 'Document Linker',
    icon: 'Link',
    description: 'Liaison documentaire sémantique entre code et spécifications',
    category: 'data',
  },
  aiStudioDirectives: {
    name: 'AI Studio Directives',
    icon: 'Sparkles',
    description: 'Directives de modélisation et prompts contextuels',
    category: 'ai',
  },
  telegram: {
    name: 'Telegram Bot',
    icon: 'MessageSquare',
    description: 'Envoi de messages, photos, documents, notifications et diffusion via le bot Telegram',
    category: 'communication',
  },
};

// ─── Utilitaires de normalisation & génération d'exemples ──────────────────────

function normalizeParameters(params: any): {
  type: string;
  properties: Record<string, {
    type: string;
    description?: string;
    required?: boolean;
    enum?: any[];
    default?: any;
    items?: any;
  }>;
  required: string[];
} {
  if (!params || typeof params !== 'object') {
    return { type: 'OBJECT', properties: {}, required: [] };
  }

  // Si c'est un format Zod brut ou objet simple
  const rawProperties = params.properties || {};
  const requiredList: string[] = Array.isArray(params.required) ? params.required : [];

  const properties: Record<string, any> = {};

  for (const [key, value] of Object.entries(rawProperties)) {
    const val = value as any;
    const type = String(val?.type || 'STRING').toUpperCase();
    const isReq = requiredList.includes(key);

    properties[key] = {
      type,
      description: val?.description || '',
      required: isReq,
      ...(val?.enum ? { enum: val.enum } : {}),
      ...(val?.default !== undefined ? { default: val.default } : {}),
      ...(val?.items ? { items: val.items } : {}),
    };
  }

  return {
    type: 'OBJECT',
    properties,
    required: requiredList,
  };
}

function generateExamplePayload(properties: Record<string, any>, required: string[]): Record<string, any> {
  const example: Record<string, any> = {};

  for (const [key, prop] of Object.entries(properties)) {
    const isRequired = required.includes(key);
    // Inclure obligatoirement les champs requis, et les 3 premiers champs optionnels pour l'exemple
    if (!isRequired && Object.keys(example).length >= 4) continue;

    const lowerKey = key.toLowerCase();
    const propType = (prop.type || 'STRING').toUpperCase();

    if (prop.default !== undefined) {
      example[key] = prop.default;
    } else if (prop.enum && prop.enum.length > 0) {
      example[key] = prop.enum[0];
    } else if (propType === 'BOOLEAN') {
      example[key] = true;
    } else if (propType === 'NUMBER') {
      example[key] = lowerKey.includes('port') ? 3000 : lowerKey.includes('limit') ? 10 : 42;
    } else if (propType === 'ARRAY') {
      example[key] = lowerKey.includes('file') ? ['src/index.ts'] : ['sample_item'];
    } else if (propType === 'OBJECT') {
      example[key] = { key: 'value' };
    } else {
      // String contextualisé
      if (lowerKey.includes('path') || lowerKey.includes('file')) {
        example[key] = 'package.json';
      } else if (lowerKey.includes('query') || lowerKey.includes('search')) {
        example[key] = 'import React';
      } else if (lowerKey.includes('url')) {
        example[key] = 'https://github.com';
      } else if (lowerKey.includes('cmd') || lowerKey.includes('command')) {
        example[key] = 'git status';
      } else if (lowerKey.includes('title') || lowerKey.includes('name')) {
        example[key] = 'Exemple de nom';
      } else {
        example[key] = prop.description ? `Exemple: ${prop.description.slice(0, 30)}` : 'valeur_exemple';
      }
    }
  }

  return example;
}

function generateCodeSnippets(toolName: string, exampleArgs: Record<string, any>) {
  const argsJson = JSON.stringify(exampleArgs, null, 2);

  const typescript = `// Appel de l'outil "${toolName}" via le runtime Leanna
const result = await skillManager.handleToolCall('${toolName}', ${argsJson});
console.log('Résultat:', result);`;

  const curl = `curl -X POST "http://localhost:3000/api/skills/execute" \\
  -H "Content-Type: application/json" \\
  -H "x-leanna-token: YOUR_TOKEN" \\
  -d '${JSON.stringify({ toolName, args: exampleArgs })}'`;

  return {
    typescript,
    curl,
    json: JSON.stringify({ name: toolName, args: exampleArgs }, null, 2),
  };
}

// ─── Factory de création du routeur ───────────────────────────────────────────

export function createSkillsRouter(skillManager?: any, runtime?: any): Router {
  const router = Router();

  // GET /api/skills — Compatibilité existante avec statuts et liste de base
  router.get('/', (_req: Request, res: Response) => {
    const supabaseConfigured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

    // Si skillManager est disponible, enrichir dynamiquement avec les skills enregistrés
    const registeredSkills: any[] = [];
    const seenIds = new Set<string>();

    const baseSkills = [
      { id: 'time', name: 'Time & Date', icon: 'Clock', status: 'active' },
      { id: 'weather', name: 'Weather', icon: 'CloudRain', status: 'active' },
      { id: 'github', name: 'GitHub', icon: 'Github', status: 'active' },
      { id: 'list', name: 'Lists', icon: 'List', status: 'active' },
      { id: 'memory', name: 'Long-term Memory (Supabase)', icon: 'Database', status: supabaseConfigured ? 'authenticated' : 'requires_auth' },
      { id: 'automation', name: 'Automation (Puppeteer)', icon: 'Globe', status: 'active' },
      { id: 'system', name: 'OS Control (Electron/Node)', icon: 'Monitor', status: 'active' },
      { id: 'reasoning', name: 'Background Tasks (Gemini Pro)', icon: 'Blocks', status: 'active' },
      { id: 'codebase', name: 'Codebase Editor', icon: 'Code', status: 'active' },
      { id: 'security_audit', name: 'Autonomous Security Audit', icon: 'ShieldCheck', status: 'active' },
      { id: 'history', name: 'Conversation History (Supabase)', icon: 'History', status: supabaseConfigured ? 'authenticated' : 'requires_auth' },
      { id: 'telegram', name: 'Telegram Bot', icon: 'MessageSquare', status: 'active' },
    ];

    for (const item of baseSkills) {
      seenIds.add(item.id);
      registeredSkills.push(item);
    }

    if (skillManager && typeof skillManager.getSkills === 'function') {
      try {
        const legacySkills = skillManager.getSkills();
        for (const s of legacySkills) {
          if (!seenIds.has(s.name)) {
            const meta = BUILTIN_SKILL_META[s.name];
            registeredSkills.push({
              id: s.name,
              name: meta?.name || s.name,
              icon: meta?.icon || 'Blocks',
              status: 'active',
            });
            seenIds.add(s.name);
          }
        }
      } catch (e) {
        // En cas d'erreur de découverte, la liste de base reste fournie
      }
    }

    res.json({ skills: registeredSkills });
  });

  // GET /api/skills/docs — Documentation interactive auto-générée depuis les déclarations
  router.get('/docs', (_req: Request, res: Response) => {
    try {
      const registry = runtime?.tools || (skillManager && typeof skillManager.getRegistry === 'function' ? skillManager.getRegistry() : null);

      // Collecter les définitions et métriques
      let toolEntries: Array<{ definition: any; metrics?: any }> = [];

      if (registry && typeof registry.getToolEntries === 'function') {
        toolEntries = registry.getToolEntries();
      } else if (registry && typeof registry.getDefinitions === 'function') {
        const defs = registry.getDefinitions();
        const metricsMap = typeof registry.getToolMetrics === 'function' ? registry.getToolMetrics() : {};
        toolEntries = defs.map((d: any) => ({
          definition: d,
          metrics: metricsMap[d.declaration?.name] || { calls: 0, failures: 0, totalMs: 0 },
        }));
      } else if (skillManager && typeof skillManager.getToolDeclarations === 'function') {
        const decls = skillManager.getToolDeclarations();
        toolEntries = decls.map((d: any) => ({
          definition: {
            declaration: d,
            category: 'general',
            permissions: ['read'],
            timeoutMs: 60000,
          },
          metrics: { calls: 0, failures: 0, totalMs: 0 },
        }));
      }

      // Si aucun registry n'est injecté (ex: tests unitaires isolés sans bootstrap),
      // générer des déclarations de démonstration complètes à partir de la liste de base
      if (toolEntries.length === 0) {
        const sampleTools = [
          {
            name: 'get_current_time',
            category: 'time',
            description: 'Obtenir l\'heure et la date actuelles du système au format localisé.',
            parameters: {
              type: 'OBJECT',
              properties: {
                timezone: { type: 'STRING', description: 'Fuseau horaire optionnel (ex: "Europe/Paris")' },
              },
              required: [],
            },
            permissions: ['read'],
            timeoutMs: 5000,
          },
          {
            name: 'get_weather',
            category: 'weather',
            description: 'Obtenir les conditions météorologiques actuelles pour une ville donnée.',
            parameters: {
              type: 'OBJECT',
              properties: {
                city: { type: 'STRING', description: 'Nom de la ville (ex: "Paris", "Tokyo")' },
                units: { type: 'STRING', description: 'Unités de mesure ("celsius" ou "fahrenheit")', enum: ['celsius', 'fahrenheit'] },
              },
              required: ['city'],
            },
            permissions: ['network'],
            timeoutMs: 15000,
          },
          {
            name: 'read_project_file',
            category: 'codebase',
            description: 'Lire le contenu d\'un fichier du projet avec numérotation de lignes.',
            parameters: {
              type: 'OBJECT',
              properties: {
                filePath: { type: 'STRING', description: 'Chemin relatif du fichier dans le projet' },
                startLine: { type: 'NUMBER', description: 'Numéro de première ligne (1-indexed)' },
                endLine: { type: 'NUMBER', description: 'Numéro de dernière ligne (1-indexed)' },
              },
              required: ['filePath'],
            },
            permissions: ['read'],
            timeoutMs: 30000,
          },
          {
            name: 'system_execute_command',
            category: 'system',
            description: 'Exécuter une commande sécurisée dans le terminal du projet.',
            parameters: {
              type: 'OBJECT',
              properties: {
                command: { type: 'STRING', description: 'Ligne de commande à exécuter' },
                timeoutMs: { type: 'NUMBER', description: 'Délai d\'expiration maximal en millisecondes' },
              },
              required: ['command'],
            },
            permissions: ['execute', 'dangerous'],
            timeoutMs: 60000,
          },
          {
            name: 'search_memory',
            category: 'memory',
            description: 'Rechercher des faits et contextes pertinents dans la mémoire à long terme.',
            parameters: {
              type: 'OBJECT',
              properties: {
                query: { type: 'STRING', description: 'Requête de recherche textuelle ou conceptuelle' },
                limit: { type: 'NUMBER', description: 'Nombre maximum de résultats à retourner' },
              },
              required: ['query'],
            },
            permissions: ['read', 'network'],
            timeoutMs: 20000,
          },
        ];

        toolEntries = sampleTools.map((t) => ({
          definition: {
            declaration: {
              name: t.name,
              description: t.description,
              parameters: t.parameters,
            },
            category: t.category,
            permissions: t.permissions,
            timeoutMs: t.timeoutMs,
          },
          metrics: { calls: 0, failures: 0, totalMs: 0 },
        }));
      }

      // Regrouper les outils par compétence/catégorie
      const skillsMap = new Map<string, any>();
      let totalCalls = 0;
      let totalFailures = 0;

      for (const entry of toolEntries) {
        const def = entry.definition;
        const decl = def.declaration || {};
        const toolName = String(decl.name || 'unnamed_tool');
        const description = String(decl.description || 'Aucune description fournie.');
        const category = String(def.category || 'general');
        const permissions = Array.isArray(def.permissions) ? def.permissions : ['read'];
        const timeoutMs = Number(def.timeoutMs || 60000);

        const metrics = entry.metrics || { calls: 0, failures: 0, totalMs: 0 };
        totalCalls += metrics.calls || 0;
        totalFailures += metrics.failures || 0;

        const avgMs = metrics.calls > 0 ? Math.round((metrics.totalMs || 0) / metrics.calls) : 0;

        const normalizedParams = normalizeParameters(decl.parameters);
        const examplePayload = generateExamplePayload(normalizedParams.properties, normalizedParams.required);
        const codeSnippets = generateCodeSnippets(toolName, examplePayload);

        const toolDoc = {
          name: toolName,
          category,
          description,
          parameters: normalizedParams,
          permissions,
          timeoutMs,
          metrics: {
            calls: metrics.calls || 0,
            failures: metrics.failures || 0,
            avgMs,
          },
          example: examplePayload,
          codeSnippets,
        };

        if (!skillsMap.has(category)) {
          const meta = BUILTIN_SKILL_META[category] || {
            name: category.charAt(0).toUpperCase() + category.slice(1),
            icon: 'Blocks',
            description: `Ensemble d'outils pour la catégorie ${category}`,
            category,
          };

          const isSupabaseDependent = category === 'memory' || category === 'history';
          const supabaseConfigured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
          const status = isSupabaseDependent ? (supabaseConfigured ? 'authenticated' : 'requires_auth') : 'active';

          skillsMap.set(category, {
            id: category,
            name: meta.name,
            icon: meta.icon,
            description: meta.description,
            category: meta.category,
            status,
            isCustom: category === 'custom' || !BUILTIN_SKILL_META[category],
            tools: [],
          });
        }

        skillsMap.get(category).tools.push(toolDoc);
      }

      // Finaliser la liste des compétences et trier
      const skills = Array.from(skillsMap.values()).map((s) => ({
        ...s,
        toolCount: s.tools.length,
      }));

      // Trier les skills alphabétiquement (avec les catégories prioritaires en premier)
      const priority = ['codebase', 'system', 'automation', 'github', 'time', 'weather', 'memory'];
      skills.sort((a, b) => {
        const idxA = priority.indexOf(a.id);
        const idxB = priority.indexOf(b.id);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return a.name.localeCompare(b.name);
      });

      const categories = Array.from(new Set(skills.map((s) => s.category)));

      res.json({
        summary: {
          totalSkills: skills.length,
          totalTools: toolEntries.length,
          categories,
          totalCalls,
          totalFailures,
          generatedAt: new Date().toISOString(),
        },
        skills,
      });
    } catch (err: any) {
      res.status(500).json({
        error: 'Erreur lors de la génération de la documentation des skills',
        details: err?.message || String(err),
      });
    }
  });

  // POST /api/skills/execute — Runner interactif de test d'outils
  router.post('/execute', async (req: Request, res: Response) => {
    const { toolName, args } = req.body || {};

    if (!toolName || typeof toolName !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Le paramètre "toolName" est obligatoire et doit être une chaîne de caractères.',
      });
    }

    const payloadArgs = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
    const startTime = Date.now();

    try {
      let result: any = null;

      if (skillManager && typeof skillManager.handleToolCall === 'function') {
        result = await skillManager.handleToolCall(toolName, payloadArgs);
      } else if (runtime?.tools && typeof runtime.tools.call === 'function') {
        result = await runtime.tools.call(toolName, payloadArgs);
      } else {
        // Cas sans runtime connecté (simulateur d'exécution pour tests ou environnement standalone)
        if (toolName === 'get_current_time') {
          result = {
            time: new Date().toLocaleTimeString('fr-FR'),
            date: new Date().toLocaleDateString('fr-FR'),
          };
        } else if (toolName === 'echo') {
          result = { received: payloadArgs };
        } else {
          throw new Error(`Outil "${toolName}" introuvable ou gestionnaire d'outils non disponible.`);
        }
      }

      const durationMs = Date.now() - startTime;
      return res.json({
        success: true,
        toolName,
        durationMs,
        result: result ?? { message: 'Action exécutée avec succès' },
      });
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      return res.status(500).json({
        success: false,
        toolName,
        durationMs,
        error: err?.message || String(err),
      });
    }
  });

  return router;
}

// Export par défaut pour rétro-compatibilité avec les tests et routes existantes
const defaultRouter = createSkillsRouter();
export default defaultRouter;
