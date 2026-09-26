/**
 * AgentLoader — Chargement dynamique d'agents-plugins
 * 
 * Permet d'ajouter de nouveaux agents au runtime sans redémarrage.
 * Scanne un dossier pour les fichiers *.agent.ts et les charge automatiquement.
 * 
 * Usage :
 *   const loader = new AgentLoader(runtime);
 *   await loader.loadFromDirectory("./custom-agents");
 *   loader.watch("./custom-agents"); // hot-reload
 */

import * as fs from "fs";
import * as path from "path";
import type { AgentRuntime, AgentPlugin } from "./AgentRuntime.js";

// ═══════════════════════════════════════════════════════════════════════════════
// AgentLoader
// ═══════════════════════════════════════════════════════════════════════════════

export class AgentLoader {
  private runtime: AgentRuntime;
  private loadedFiles = new Map<string, string>(); // filePath → agentId
  private watcher: fs.FSWatcher | null = null;

  constructor(runtime: AgentRuntime) {
    this.runtime = runtime;
  }

  /**
   * Charge tous les agents *.agent.ts d'un dossier.
   * Retourne le nombre d'agents chargés.
   */
  async loadFromDirectory(dir: string): Promise<number> {
    if (!fs.existsSync(dir)) {
      console.warn(`[AgentLoader] Dossier introuvable: ${dir}`);
      return 0;
    }

    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".agent.ts") || f.endsWith(".agent.js"));
    let count = 0;

    for (const file of files) {
      try {
        const filePath = path.join(dir, file);
        const loaded = await this.loadFile(filePath);
        if (loaded) count++;
      } catch (err) {
        console.error(`[AgentLoader] Erreur chargement ${file}:`, (err as Error).message);
      }
    }

    console.log(`[AgentLoader] ${count} agent(s) chargé(s) depuis ${dir}`);
    return count;
  }

  /**
   * Charge un seul fichier agent.
   */
  async loadFile(filePath: string): Promise<boolean> {
    try {
      // Invalidate le cache pour le hot-reload
      const resolvedPath = path.resolve(filePath);
      
      // Import dynamique (ESM)
      const moduleUrl = new URL(`file://${resolvedPath}`).href;
      const module = await import(moduleUrl);

      // Chercher l'export qui ressemble à un AgentPlugin
      const agent = this.findAgentExport(module);
      if (!agent) {
        console.warn(`[AgentLoader] Aucun AgentPlugin trouvé dans ${path.basename(filePath)}`);
        return false;
      }

      // Valider la structure
      if (!this.validatePlugin(agent)) {
        console.warn(`[AgentLoader] Plugin invalide dans ${path.basename(filePath)}`);
        return false;
      }

      // Désenregistrer l'ancien agent si rechargement
      const existingId = this.loadedFiles.get(resolvedPath);
      if (existingId) {
        this.runtime.unregisterAgent(existingId);
      }

      // Enregistrer dans le runtime
      this.runtime.registerAgent(agent);
      this.loadedFiles.set(resolvedPath, agent.metadata.id);

      console.log(`[AgentLoader] Agent "${agent.metadata.name}" (${agent.metadata.id}) chargé`);
      return true;
    } catch (err) {
      console.error(`[AgentLoader] Erreur: ${(err as Error).message}`);
      return false;
    }
  }

  /**
   * Surveille un dossier et recharge les agents modifiés.
   */
  watch(dir: string): void {
    if (this.watcher) {
      this.watcher.close();
    }

    if (!fs.existsSync(dir)) return;

    this.watcher = fs.watch(dir, { persistent: false }, (eventType, filename) => {
      if (!filename || (!filename.endsWith(".agent.ts") && !filename.endsWith(".agent.js"))) return;
      
      const filePath = path.join(dir, filename);
      
      // Debounce : attendre que le fichier soit stable
      setTimeout(async () => {
        if (fs.existsSync(filePath)) {
          console.log(`[AgentLoader] Rechargement: ${filename}`);
          await this.loadFile(filePath);
        } else {
          // Fichier supprimé → désenregistrer l'agent
          const resolvedPath = path.resolve(filePath);
          const agentId = this.loadedFiles.get(resolvedPath);
          if (agentId) {
            this.runtime.unregisterAgent(agentId);
            this.loadedFiles.delete(resolvedPath);
            console.log(`[AgentLoader] Agent "${agentId}" déchargé (fichier supprimé)`);
          }
        }
      }, 200);
    });

    console.log(`[AgentLoader] Surveillance active: ${dir}`);
  }

  /**
   * Arrête la surveillance.
   */
  stopWatching(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  /**
   * Retourne la liste des fichiers chargés et leurs agents.
   */
  getLoaded(): Array<{ file: string; agentId: string }> {
    return Array.from(this.loadedFiles.entries()).map(([file, agentId]) => ({
      file: path.basename(file),
      agentId,
    }));
  }

  // ─── Privé ───────────────────────────────────────────────────────────────

  private findAgentExport(module: any): AgentPlugin | null {
    // Chercher un export nommé qui a metadata + execute
    for (const key of Object.keys(module)) {
      const exported = module[key];
      if (this.validatePlugin(exported)) {
        return exported;
      }
    }
    // Default export
    if (module.default && this.validatePlugin(module.default)) {
      return module.default;
    }
    return null;
  }

  private validatePlugin(obj: any): obj is AgentPlugin {
    return (
      obj &&
      typeof obj === "object" &&
      obj.metadata &&
      typeof obj.metadata.id === "string" &&
      typeof obj.metadata.name === "string" &&
      typeof obj.execute === "function"
    );
  }
}
