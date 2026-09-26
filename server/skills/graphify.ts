/**
 * graphify.ts — Skill Leanna pour l'interrogation du Graphe de Connaissances Graphify
 *
 * Permet à Leanna d'utiliser les outils Graphify (BFS query, plus court chemin,
 * inspection de nœud, analyse d'impact, hubs architecturaux et mise à jour)
 * pour répondre de façon factuelle et ciblée aux questions sur le codebase.
 */

import { Skill, validateArgs } from "./base.js";
import { z } from "zod";
import * as path from "path";
import * as fs from "fs";
import { execFile } from "child_process";
import { SELF_ROOT, Leanna_APP_ROOT } from "../utils/selfRoot.js";

/**
 * Résout le chemin du binaire graphify de manière robuste sur Windows / macOS / Linux.
 */
export function getGraphifyBinaryPath(): string {
  if (process.env.GRAPHIFY_BIN && fs.existsSync(process.env.GRAPHIFY_BIN)) {
    return process.env.GRAPHIFY_BIN;
  }
  const userProfile = process.env.USERPROFILE || process.env.HOME || "";
  const localBinExe = path.join(userProfile, ".local", "bin", process.platform === "win32" ? "graphify.exe" : "graphify");
  if (fs.existsSync(localBinExe)) {
    return localBinExe;
  }
  return process.platform === "win32" ? "graphify.exe" : "graphify";
}

/**
 * Résout le répertoire de travail cible pour les commandes graphify.
 */
export function getGraphifyCwd(): string {
  if (SELF_ROOT && SELF_ROOT.trim().length > 0 && fs.existsSync(SELF_ROOT)) {
    return SELF_ROOT;
  }
  if (Leanna_APP_ROOT && fs.existsSync(Leanna_APP_ROOT)) {
    return Leanna_APP_ROOT;
  }
  return process.cwd();
}

/**
 * Exécute une commande graphify avec buffer et timeout contrôlés.
 */
export function executeGraphify(
  args: string[],
  cwd?: string,
  timeoutMs = 25000
): Promise<{ success: boolean; output: string; error?: string }> {
  const binary = getGraphifyBinaryPath();
  const targetCwd = cwd || getGraphifyCwd();

  return new Promise((resolve) => {
    execFile(
      binary,
      args,
      {
        cwd: targetCwd,
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env },
      },
      (err, stdout, stderr) => {
        const outStr = (stdout || "").trim();
        const errStr = (stderr || "").trim();

        if (err) {
          const combinedMsg = errStr || outStr || err.message;
          resolve({
            success: false,
            output: outStr,
            error: `Erreur d'exécution graphify (${err.name}): ${combinedMsg}`,
          });
        } else {
          resolve({
            success: true,
            output: outStr || "(Résultat vide)",
          });
        }
      }
    );
  });
}

// ─── Schémas Zod ─────────────────────────────────────────────────────────────

const QuerySchema = z.object({
  question: z.string().min(1, "La question ne peut pas être vide"),
  budget: z.number().optional().default(2000),
  dfs: z.boolean().optional().default(false),
});

const PathSchema = z.object({
  from: z.string().min(1, "Le nœud source 'from' est requis"),
  to: z.string().min(1, "Le nœud cible 'to' est requis"),
});

const ExplainSchema = z.object({
  node: z.string().min(1, "Le paramètre 'node' est requis"),
});

const AffectedSchema = z.object({
  node: z.string().min(1, "Le paramètre 'node' est requis"),
  depth: z.number().optional().default(2),
});

const GodNodesSchema = z.object({
  top: z.number().optional().default(15),
});

const ReadReportSchema = z.object({
  section: z.enum(["summary", "hubs", "all"]).optional().default("summary"),
});

const UpdateSchema = z.object({
  force: z.boolean().optional().default(false),
});

// ─── Déclarations des outils pour le LLM ─────────────────────────────────────

export const graphifySkill: Skill = {
  name: "graphify",
  declarations: [
    {
      name: "graphify_query",
      description:
        "🔎 Outil PRINCIPAL de recherche architecturale. Explore le graphe relationnel Graphify (5500+ nœuds, arêtes, communautés) par parcours BFS pour répondre à une question sur le codebase. Retourne les symboles, fichiers, lignes et communautés exactes.",
      parameters: {
        type: "OBJECT",
        properties: {
          question: {
            type: "STRING",
            description:
              "La question ou le concept technique à explorer dans le codebase (ex: 'comment fonctionne le WebSocket de chat', 'gestion des tokens Gemini', 'flux des agents').",
          },
          budget: {
            type: "NUMBER",
            description: "Plafond de tokens pour le sous-graphe retourné (défaut: 2000).",
          },
          dfs: {
            type: "BOOLEAN",
            description: "Utiliser un parcours en profondeur (DFS) au lieu du BFS.",
          },
        },
        required: ["question"],
      },
    },
    {
      name: "graphify_path",
      description:
        "🔗 Trouve le plus court chemin relationnel (imports, appels, dépendances) reliant deux nœuds, fichiers ou composants dans le graphe.",
      parameters: {
        type: "OBJECT",
        properties: {
          from: {
            type: "STRING",
            description: "Nœud ou fichier source (ex: 'server.ts', 'LiveSocketHandler.ts').",
          },
          to: {
            type: "STRING",
            description: "Nœud ou fichier cible (ex: 'knowledgeGraph', 'AgentOrchestrator').",
          },
        },
        required: ["from", "to"],
      },
    },
    {
      name: "graphify_explain",
      description:
        "📖 Fiche détaillée d'un nœud / symbole : source (fichier + ligne), communauté, degré de connectivité, liste complète des connexions entrantes (appelants) et sortantes.",
      parameters: {
        type: "OBJECT",
        properties: {
          node: {
            type: "STRING",
            description: "Nom du symbole, fichier, classe ou fonction à inspecter.",
          },
        },
        required: ["node"],
      },
    },
    {
      name: "graphify_affected",
      description:
        "⚠️ Analyse d'impact inverse : liste tous les fichiers, fonctions et modules qui dépendent d'un nœud donné et qui seraient affectés en cas de modification.",
      parameters: {
        type: "OBJECT",
        properties: {
          node: {
            type: "STRING",
            description: "Nom du nœud / symbole dont on souhaite évaluer l'impact.",
          },
          depth: {
            type: "NUMBER",
            description: "Profondeur de parcours inverse (défaut: 2).",
          },
        },
        required: ["node"],
      },
    },
    {
      name: "graphify_god_nodes",
      description:
        "👑 Liste les points cardinaux (hubs architecturaux) les plus connectés du projet avec leur nombre de liaisons.",
      parameters: {
        type: "OBJECT",
        properties: {
          top: {
            type: "NUMBER",
            description: "Nombre de hubs à retourner (défaut: 15).",
          },
        },
      },
    },
    {
      name: "graphify_read_report",
      description:
        "📊 Lit le rapport synthétique d'architecture Graphify (graphify-out/GRAPH_REPORT.md) : taille du corpus, état de fraîcheur et hubs majeurs.",
      parameters: {
        type: "OBJECT",
        properties: {
          section: {
            type: "STRING",
            description: "Section : 'summary' (résumé + hubs), 'hubs' (liste des hubs), ou 'all' (rapport complet plafonné). Défaut: 'summary'.",
            enum: ["summary", "hubs", "all"],
          },
        },
      },
    },
    {
      name: "graphify_update",
      description:
        "🔄 Met à jour le graphe relationnel Graphify après des modifications de code (extraction AST rapide, sans appel LLM).",
      parameters: {
        type: "OBJECT",
        properties: {
          force: {
            type: "BOOLEAN",
            description: "Forcer la mise à jour même si le nombre de nœuds diminue.",
          },
        },
      },
    },
  ],

  handleToolCall: async (name: string, rawArgs: any) => {
    const cwd = getGraphifyCwd();

    switch (name) {
      case "graphify_query": {
        const { question, budget, dfs } = validateArgs(QuerySchema, rawArgs, name);
        const args = ["query", question];
        if (budget) args.push("--budget", String(budget));
        if (dfs) args.push("--dfs");

        const result = await executeGraphify(args, cwd);
        if (!result.success) {
          return {
            status: "error",
            message: result.error,
            tip: "Vérifiez que graphify-out/graph.json existe ou lancez graphify_update.",
          };
        }
        return {
          status: "success",
          query: question,
          graphContext: result.output,
        };
      }

      case "graphify_path": {
        const { from, to } = validateArgs(PathSchema, rawArgs, name);
        const result = await executeGraphify(["path", from, to], cwd);
        if (!result.success) {
          return {
            status: "error",
            message: result.error,
          };
        }
        return {
          status: "success",
          from,
          to,
          path: result.output,
        };
      }

      case "graphify_explain": {
        const { node } = validateArgs(ExplainSchema, rawArgs, name);
        const result = await executeGraphify(["explain", node], cwd);
        if (!result.success) {
          return {
            status: "error",
            message: result.error,
          };
        }
        return {
          status: "success",
          node,
          explanation: result.output,
        };
      }

      case "graphify_affected": {
        const { node, depth } = validateArgs(AffectedSchema, rawArgs, name);
        const args = ["affected", node];
        if (depth) args.push("--depth", String(depth));

        const result = await executeGraphify(args, cwd);
        if (!result.success) {
          return {
            status: "error",
            message: result.error,
          };
        }
        return {
          status: "success",
          node,
          affected: result.output,
        };
      }

      case "graphify_god_nodes": {
        const { top } = validateArgs(GodNodesSchema, rawArgs, name);
        const result = await executeGraphify(["god-nodes", "--top", String(top)], cwd);
        if (!result.success) {
          return {
            status: "error",
            message: result.error,
          };
        }
        return {
          status: "success",
          top,
          hubs: result.output,
        };
      }

      case "graphify_read_report": {
        const { section } = validateArgs(ReadReportSchema, rawArgs, name);
        const reportPath = path.join(cwd, "graphify-out", "GRAPH_REPORT.md");

        if (!fs.existsSync(reportPath)) {
          return {
            status: "error",
            message: `Le fichier ${reportPath} n'existe pas encore. Exécutez graphify_update pour le générer.`,
          };
        }

        try {
          const content = fs.readFileSync(reportPath, "utf-8");
          const lines = content.split("\n");

          if (section === "hubs") {
            const hubStart = lines.findIndex((l) => l.includes("## Community Hubs"));
            if (hubStart !== -1) {
              const hubsSlice = lines.slice(hubStart, hubStart + 60).join("\n");
              return { status: "success", section: "hubs", content: hubsSlice };
            }
          }

          if (section === "summary") {
            const summarySlice = lines.slice(0, 75).join("\n");
            return { status: "success", section: "summary", content: summarySlice };
          }

          // "all" — plafonné à 200 lignes pour économiser le contexte
          const cappedContent = lines.slice(0, 200).join("\n");
          return {
            status: "success",
            section: "all",
            linesCount: lines.length,
            content: cappedContent,
            truncated: lines.length > 200,
          };
        } catch (e: any) {
          return { status: "error", message: `Erreur lecture GRAPH_REPORT.md: ${e.message}` };
        }
      }

      case "graphify_update": {
        const { force } = validateArgs(UpdateSchema, rawArgs, name);
        const args = ["update", "."];
        if (force) args.push("--force");

        const result = await executeGraphify(args, cwd, 60000);
        return {
          status: result.success ? "success" : "error",
          message: result.success ? "Graphe de connaissances mis à jour avec succès." : result.error,
          output: result.output,
        };
      }

      default:
        throw new Error(`Outil Graphify inconnu: ${name}`);
    }
  },
};
