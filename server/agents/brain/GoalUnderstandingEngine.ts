import * as fs from "fs";
import * as path from "path";
import type { BrainGoalInput, GoalUnderstanding, ProjectDomain, ComplexityLevel } from "./types.js";
import { generateText } from "../../utils/textGeneration.js";
import { createLogger } from "../../utils/logger.js";
import { getProjectRoot } from "../../skills/codebaseHelpers.js";

const log = createLogger("GoalUnderstandingEngine");

export class GoalUnderstandingEngine {
  /**
   * Analyse et comprend l'objectif utilisateur en s'appuyant sur l'inspection
   * de la codebase et/ou le LLM.
   */
  async understand(input: BrainGoalInput): Promise<GoalUnderstanding> {
    const goal = input.goal.trim();
    log.info(`🧠 Analyse de l'objectif: "${goal.slice(0, 80)}..."`);

    // 1. Détection du contexte projet (package.json, tsconfig, structure)
    const projectInfo = this.inspectProject();

    // 2. Détection heuristique initiale des fichiers pertinents
    const discoveredFiles = this.discoverRelevantFiles(goal, input.contextFiles ?? []);

    // 3. Essai de structuration via LLM
    try {
      const llmUnderstanding = await this.understandWithLLM(goal, input, projectInfo, discoveredFiles);
      if (llmUnderstanding) {
        log.info(`✅ Compréhension LLM validée (domaine: ${llmUnderstanding.domain}, complexité: ${llmUnderstanding.complexity})`);
        return llmUnderstanding;
      }
    } catch (err: any) {
      log.warn(`⚠️ Échec compréhension LLM (${err.message}), bascule sur l'analyseur déterministe`);
    }

    // 4. Fallback déterministe robuste (sans LLM / mode offline / test)
    return this.understandHeuristic(goal, input, projectInfo, discoveredFiles);
  }

  /**
   * Analyse heuristique déterministe de l'objectif
   */
  understandHeuristic(
    goal: string,
    input: BrainGoalInput,
    projectInfo: { techStack: string[]; hasReact: boolean; hasTypeScript: boolean },
    discoveredFiles: string[]
  ): GoalUnderstanding {
    const lower = goal.toLowerCase();

    // Domaine (ordre important : du plus spécifique au plus générique)
    let domain: ProjectDomain = "general";
    if (/(doc|documentation|readme|guide|manuel)/i.test(lower)) {
      domain = "documentation";
    } else if (/(docker|ci|cd|deploy|action|workflow|pipeline)/i.test(lower)) {
      domain = "devops";
    } else if (/(bug|fix|erreur|crash|exception|ne marche pas|invalide|problème)/i.test(lower)) {
      domain = "bugfix";
    } else if (/(refactor|nettoyer|restructurer|simplifier|clean code)/i.test(lower)) {
      domain = "refactor";
    } else if (/(responsive|header|footer|css|ui|bouton|composant|style|front|react|vue|page)/i.test(lower)) {
      domain = "frontend";
    } else if (/(api|route|endpoint|database|bdd|sql|serveur|backend|express|prisma)/i.test(lower)) {
      domain = "backend";
    } else if (/(fullstack|app|application|système|site)/i.test(lower)) {
      domain = "fullstack";
    }

    // Complexité
    let complexity: ComplexityLevel = "moderate";
    const wordCount = goal.split(/\s+/).length;
    if (wordCount > 30 || /(architecture|refonte|complet|migration|sécurité|système)/i.test(lower)) {
      complexity = "complex";
    } else if (wordCount < 8 && !/(refonte|migration)/i.test(lower)) {
      complexity = "simple";
    }

    // Technologies clés
    const keyTechnologies = [...projectInfo.techStack];
    if (domain === "frontend" && !keyTechnologies.includes("CSS")) keyTechnologies.push("CSS");
    if (/(responsive|mobile|tablette)/i.test(lower) && !keyTechnologies.includes("Responsive Design")) {
      keyTechnologies.push("Responsive Design");
    }

    // Exigences et critères de succès déduits
    const requirements: string[] = [];
    const successCriteria: string[] = [];
    const potentialRisks: string[] = [];

    if (domain === "frontend" || /(responsive|header)/i.test(lower)) {
      requirements.push("Moderniser le rendu visuel et structurer le code HTML/CSS");
      requirements.push("Assurer un comportement responsive sur mobile (<768px), tablette et desktop");
      successCriteria.push("Le composant s'adapte sans débordement horizontal sur toutes les résolutions");
      successCriteria.push("Pas de régression visuelle ou de rupture de style");
      successCriteria.push("Code TypeScript et JSX exempt d'erreurs de syntaxe");
      potentialRisks.push("Casse de la mise en page parente ou des classes globales");
    } else if (domain === "bugfix") {
      requirements.push("Isoler la cause racine du dysfonctionnement");
      requirements.push("Implémenter un correctif minimal et ciblé");
      successCriteria.push("Le bug est éliminé sans effets de bord");
      successCriteria.push("Les tests de régression sont au vert");
      potentialRisks.push("Introduction d'effets de bord imprévus");
    } else {
      requirements.push(`Accomplir l'objectif : ${goal}`);
      successCriteria.push("Toutes les étapes planifiées sont exécutées avec succès");
      successCriteria.push("Vérification statique et syntaxique validée");
      potentialRisks.push("Incompatibilité avec l'architecture existante");
    }

    return {
      intent: goal,
      domain,
      complexity,
      keyTechnologies,
      relevantFiles: discoveredFiles,
      requirements,
      successCriteria,
      potentialRisks,
      rationale: `Analyse heuristique : domaine identifié comme '${domain}' avec niveau de complexité '${complexity}'. Stack détectée : ${keyTechnologies.join(", ")}.`,
    };
  }

  /**
   * Analyse enrichie par LLM si disponible
   */
  private async understandWithLLM(
    goal: string,
    input: BrainGoalInput,
    projectInfo: { techStack: string[] },
    discoveredFiles: string[]
  ): Promise<GoalUnderstanding | null> {
    const prompt = `
Tu es le module de compréhension cognitive (Agent Brain) de Leanna.
Analyse l'objectif utilisateur suivant pour un projet logiciel :

OBJECTIF : "${goal}"
INSTRUCTIONS COMPLÉMENTAIRES : "${input.instructions ?? 'Aucune'}"
STACK PROJET : ${projectInfo.techStack.join(", ") || 'TypeScript/React/Node'}
FICHIERS CONNUS : ${discoveredFiles.join(", ") || 'Non spécifiés'}

Retourne UNIQUEMENT un objet JSON avec exactement cette structure :
{
  "intent": "Résumé clair et précis de l'intention réelle de l'utilisateur",
  "domain": "frontend" | "backend" | "fullstack" | "documentation" | "devops" | "bugfix" | "refactor" | "general",
  "complexity": "simple" | "moderate" | "complex" | "critical",
  "keyTechnologies": ["tech1", "tech2"],
  "requirements": ["exigence 1", "exigence 2"],
  "successCriteria": ["critère vérifiable 1", "critère vérifiable 2"],
  "potentialRisks": ["risque 1", "risque 2"],
  "rationale": "Courte justification de l'analyse"
}
`.trim();

    const res = await generateText({
      prompt,
      temperature: 0.1,
      maxOutputTokens: 2048,
    });

    const text = res.text.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      intent: parsed.intent || goal,
      domain: parsed.domain || "general",
      complexity: parsed.complexity || "moderate",
      keyTechnologies: Array.isArray(parsed.keyTechnologies) ? parsed.keyTechnologies : projectInfo.techStack,
      relevantFiles: discoveredFiles,
      requirements: Array.isArray(parsed.requirements) ? parsed.requirements : [goal],
      successCriteria: Array.isArray(parsed.successCriteria) ? parsed.successCriteria : ["Code valide"],
      potentialRisks: Array.isArray(parsed.potentialRisks) ? parsed.potentialRisks : [],
      rationale: parsed.rationale || "Compréhension formulée par LLM",
    };
  }

  /**
   * Inspecte sommairement le projet pour identifier la stack
   */
  private inspectProject(): { techStack: string[]; hasReact: boolean; hasTypeScript: boolean } {
    const root = getProjectRoot();
    const techStack: string[] = [];
    let hasReact = false;
    let hasTypeScript = false;

    try {
      const pkgPath = path.join(root, "package.json");
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
        if (allDeps["react"]) {
          techStack.push("React");
          hasReact = true;
        }
        if (allDeps["typescript"]) {
          techStack.push("TypeScript");
          hasTypeScript = true;
        }
        if (allDeps["tailwindcss"]) techStack.push("TailwindCSS");
        if (allDeps["vite"]) techStack.push("Vite");
        if (allDeps["express"]) techStack.push("Express");
      }
    } catch {
      // Ignorer si échec de lecture
    }

    if (techStack.length === 0) {
      techStack.push("TypeScript", "React", "Node.js");
      hasReact = true;
      hasTypeScript = true;
    }

    return { techStack, hasReact, hasTypeScript };
  }

  /**
   * Découvre les fichiers du projet en lien avec l'objectif
   */
  private discoverRelevantFiles(goal: string, contextFiles: string[]): string[] {
    const files = new Set<string>(contextFiles);
    const root = getProjectRoot();
    const lower = goal.toLowerCase();

    // Mots clés typiques
    const candidates: Array<{ keyword: RegExp; paths: string[] }> = [
      { keyword: /header/i, paths: ["src/components/Header.tsx", "src/components/layout/Header.tsx", "src/Header.tsx", "src/components/ide/Header.tsx"] },
      { keyword: /sidebar/i, paths: ["src/components/sidebar/Sidebar.tsx", "src/components/Sidebar.tsx"] },
      { keyword: /chat/i, paths: ["src/components/ide/ChatPanel.tsx", "src/components/Chat.tsx"] },
      { keyword: /agent/i, paths: ["server/agents/AgentOrchestrator.ts", "server/agents/roles.ts"] },
    ];

    for (const candidate of candidates) {
      if (candidate.keyword.test(lower)) {
        for (const p of candidate.paths) {
          if (fs.existsSync(path.join(root, p))) {
            files.add(p);
          }
        }
      }
    }

    return Array.from(files);
  }
}
