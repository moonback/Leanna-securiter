/**
 * project.ts — Skill de scaffolding de projets.
 *
 * Permet à l'IA de créer un nouveau projet React (Vite, Next.js, React Router)
 * dans un dossier choisi par l'utilisateur, puis d'activer automatiquement
 * ce projet comme workspace courant (SELF_ROOT).
 *
 * Frameworks supportés :
 *   - react-vite     : npm create vite@latest -- --template react-ts
 *   - react-vite-js  : npm create vite@latest -- --template react
 *   - next           : npx create-next-app@latest
 *   - react-router   : npx create-react-router@latest
 */

import { Skill } from "./base.js";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import os from "os";

const execFileAsync = promisify(execFile);

const SCAFFOLD_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const MAX_BUFFER = 10 * 1024 * 1024; // 10 MB

type Framework =
  | "react-vite"
  | "react-vite-js"
  | "next"
  | "react-router";

interface ScaffoldCommand {
  bin: string;
  args: (name: string) => string[];
  description: string;
}

const FRAMEWORKS: Record<Framework, ScaffoldCommand> = {
  "react-vite": {
    bin: "npm",
    args: (name) => ["create", "vite@latest", name, "--", "--template", "react-ts"],
    description: "React + Vite (TypeScript)",
  },
  "react-vite-js": {
    bin: "npm",
    args: (name) => ["create", "vite@latest", name, "--", "--template", "react"],
    description: "React + Vite (JavaScript)",
  },
  "next": {
    bin: "npx",
    args: (name) => ["create-next-app@latest", name, "--typescript", "--eslint", "--tailwind", "--no-src-dir", "--app", "--import-alias", "@/*"],
    description: "Next.js (TypeScript + App Router + Tailwind)",
  },
  "react-router": {
    bin: "npx",
    args: (name) => ["create-react-router@latest", name, "--no-git-init"],
    description: "React Router v7 (TypeScript)",
  },
};

function getBinName(bin: string): string {
  if (os.platform() === "win32") {
    if (bin === "npm") return "npm.cmd";
    if (bin === "npx") return "npx.cmd";
  }
  return bin;
}

function sanitizeName(name: string): string {
  return name.trim().replace(/[^a-zA-Z0-9_\-]/g, "-").toLowerCase();
}

export const projectSkill: Skill = {
  name: "project",
  declarations: [
    {
      name: "project_scaffold",
      description:
        "Crée un nouveau projet depuis un template (React+Vite, Next.js, React Router) dans un dossier donné, puis l'active comme workspace courant. Toujours demander confirmation à l'utilisateur avant d'appeler cet outil.",
      parameters: {
        type: "OBJECT",
        properties: {
          framework: {
            type: "STRING",
            description:
              'Template à utiliser. Valeurs : "react-vite" (React+Vite TypeScript), "react-vite-js" (React+Vite JavaScript), "next" (Next.js), "react-router" (React Router v7). Défaut : "react-vite".',
          },
          name: {
            type: "STRING",
            description:
              'Nom du projet (sera aussi le nom du dossier créé). Ex : "my-app".',
          },
          parent_path: {
            type: "STRING",
            description:
              "Chemin absolu du dossier parent dans lequel créer le projet. Si absent, utilise ~/Documents/Leanna-Projects/.",
          },
        },
        required: ["name"],
      },
    },
    {
      name: "project_list_frameworks",
      description: "Liste les frameworks disponibles pour créer un nouveau projet.",
      parameters: { type: "OBJECT", properties: {} },
    },
  ],

  handleToolCall: async (name, args: Record<string, unknown>) => {
    try {
      switch (name) {
        case "project_list_frameworks": {
          return {
            status: "success",
            frameworks: Object.entries(FRAMEWORKS).map(([id, f]) => ({
              id,
              description: f.description,
            })),
          };
        }

        case "project_scaffold": {
          const rawName = typeof args.name === "string" ? args.name : "";
          if (!rawName.trim()) {
            return { error: "Le paramètre 'name' est requis." };
          }

          const projectName = sanitizeName(rawName);
          const framework = (typeof args.framework === "string" ? args.framework : "react-vite") as Framework;

          if (!FRAMEWORKS[framework]) {
            return {
              error: `Framework inconnu: "${framework}". Valeurs valides : ${Object.keys(FRAMEWORKS).join(", ")}.`,
            };
          }

          // Résoudre le dossier parent
          let parentDir: string;
          if (typeof args.parent_path === "string" && args.parent_path.trim()) {
            parentDir = path.resolve(args.parent_path.trim());
          } else {
            parentDir = path.join(os.homedir(), "Documents", "Leanna-Projects");
          }

          // Créer le dossier parent si nécessaire
          if (!fs.existsSync(parentDir)) {
            fs.mkdirSync(parentDir, { recursive: true });
          }

          const projectPath = path.join(parentDir, projectName);

          if (fs.existsSync(projectPath)) {
            return {
              error: `Un dossier "${projectName}" existe déjà dans ${parentDir}. Choisissez un autre nom.`,
            };
          }

          const frameworkConfig = FRAMEWORKS[framework];
          const bin = getBinName(frameworkConfig.bin);
          const cmdArgs = frameworkConfig.args(projectName);

          console.log(
            `[ProjectSkill] Scaffolding "${framework}" → ${projectPath}`
          );
          console.log(
            `[ProjectSkill] Commande: ${bin} ${cmdArgs.join(" ")} (cwd: ${parentDir})`
          );

          // Exécuter le scaffolding
          // Sur Node.js 20+, execFile trouve automatiquement les .cmd sur Windows
          // sans avoir besoin de shell:true (qui génère un avertissement de dépréciation)
          
          let stdout = "";
          let stderr = "";
          try {
            const result = await execFileAsync(bin, cmdArgs, {
              cwd: parentDir,
              timeout: SCAFFOLD_TIMEOUT_MS,
              maxBuffer: MAX_BUFFER,
              // Pas de shell: true - Node.js 20+ gère .cmd directement
              env: {
                ...process.env,
                // Forcer le mode non-interactif pour les outils CLI
                CI: "true",
                npm_config_yes: "true",
              },
            });
            stdout = result.stdout ?? "";
            stderr = result.stderr ?? "";
          } catch (execErr: any) {
            return {
              status: "error",
              error: execErr.killed
                ? `Timeout dépassé (${SCAFFOLD_TIMEOUT_MS / 1000}s) — le scaffolding a été interrompu.`
                : execErr.message,
              stdout: (execErr.stdout ?? "").slice(0, 3000),
              stderr: (execErr.stderr ?? "").slice(0, 3000),
            };
          }

          // Vérifier que le dossier a bien été créé
          if (!fs.existsSync(projectPath)) {
            return {
              status: "error",
              error: `Le scaffolding a terminé mais le dossier "${projectPath}" n'existe pas. Vérifiez les logs.`,
              stdout: stdout.slice(0, 3000),
              stderr: stderr.slice(0, 3000),
            };
          }

          // Activer le nouveau projet comme workspace courant
          try {
            const { switchSandboxProject } = await import("../utils/sandbox.js");

            const newRoot = await switchSandboxProject(projectPath);

            // Recharger le Knowledge System
            try {
              const { knowledgeGraph } = await import("../knowledge/KnowledgeGraph.js");
              const { projectMemory } = await import("../knowledge/ProjectMemory.js");
              const { projectIndexer } = await import("../knowledge/ProjectIndexer.js");
              knowledgeGraph.load();
              projectMemory.load();
              projectIndexer.scanAll().catch(() => {});
            } catch { /* silent */ }

            console.log(`[ProjectSkill] Projet activé: ${newRoot}`);

            return {
              status: "success",
              framework: frameworkConfig.description,
              projectPath: newRoot,
              message: `Projet "${projectName}" créé avec succès (${frameworkConfig.description}). Le workspace a été basculé sur ce projet. Vous pouvez maintenant lancer \`npm install\` puis \`npm run dev\`.`,
              stdout: stdout.slice(0, 2000),
            };
          } catch (activateErr: any) {
            return {
              status: "partial",
              projectPath,
              error: `Scaffolding réussi mais activation du projet échouée : ${activateErr.message}`,
              stdout: stdout.slice(0, 2000),
            };
          }
        }

        default:
          return { error: `Outil inconnu: ${name}` };
      }
    } catch (err: any) {
      return { error: `Erreur inattendue: ${err?.message ?? String(err)}` };
    }
  },
};
