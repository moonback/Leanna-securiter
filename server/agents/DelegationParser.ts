/**
 * DelegationParser — Extrait les instructions de délégation de la sortie texte des agents
 *
 * Robustesse améliorée :
 * - Regex Unicode-aware (tolère é/e/E/É et toutes variantes d'accent)
 * - Tolère les espaces, tirets, variations de casse dans les clés
 * - Supporte plusieurs blocs par sortie
 * - Valide la matrice de délégation
 * - Dead-letter logging pour les blocs ignorés
 */

import type { AgentRole, TaskPriority } from "./types.js";
import { DELEGATION_MATRIX as _DELEGATION_MATRIX, isDelegationAllowed } from "./AgentCommunication.js";
import { listAgentRoles } from "./roles.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("DelegationParser");

/**
 * Retourne les rôles valides (statiques + dynamiques).
 * Le cache est recalculé à chaque appel pour supporter
 * les agents enregistrés dynamiquement.
 */
function getValidRoles(): Set<string> {
  // Toujours recalculer pour être sûr d'avoir les derniers agents dynamiques
  const roles = listAgentRoles();
  return new Set(roles);
}
const VALID_PRIORITIES = new Set<TaskPriority>(["low", "medium", "high", "critical"]);

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface ParsedDelegation {
  targetRole: AgentRole;
  reason: string;
  files: string[];
  priority: TaskPriority;
  instructions?: string;
  blockIndex: number;
}

export interface DelegationParseResult {
  delegations: ParsedDelegation[];
  warnings: string[];
  /** Texte brut des blocs rejetés — pour diagnostic */
  droppedBlocks: string[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// DelegationParser
// ═══════════════════════════════════════════════════════════════════════════════

export class DelegationParser {
  /**
   * Parse tous les blocs ## DÉLÉGATION dans la sortie d'un agent.
   * Tolère toutes les variantes Unicode/casse produites par les LLMs.
   */
  parse(text: string, fromRole: AgentRole): DelegationParseResult {
    const delegations: ParsedDelegation[] = [];
    const warnings: string[] = [];
    const droppedBlocks: string[] = [];

    // ── Normalisation Unicode avant le parsing ──────────────────────────────
    // Convertit les caractères composés (é = e + combining accent) en leur
    // forme précomposée (é = U+00E9). Le LLM peut émettre les deux formes.
    const normalized = text.normalize("NFC");

    // ── Regex robuste ────────────────────────────────────────────────────────
    // Variantes acceptées du titre de section :
    //   ## DÉLÉGATION  ## DELEGATION  ## Délégation  ## délégation
    //   ## DELEG  ## délég  (préfixe min 5 chars pour éviter faux positifs)
    // Fin de bloc : prochaine section ## ou --- ou fin de texte
    const blockPattern =
      /##\s*D(?:[ÉÈEée][ÉÈEée]?L[ÉÈEée]?|[Ee]l[ée]?)[gG][aA][tT][iI][oO][nN]\s*\n([\s\S]*?)(?=\n##\s|\n---+\s*\n|$)/gi;

    let match: RegExpExecArray | null;
    let blockIndex = 0;

    while ((match = blockPattern.exec(normalized)) !== null) {
      blockIndex++;
      const blockContent = match[1];
      log.debug(`Bloc DÉLÉGATION #${blockIndex} trouvé (${blockContent.length} chars)`);

      const result = this.parseBlock(blockContent, fromRole, blockIndex);

      if (result.delegation) {
        delegations.push(result.delegation);
      } else {
        droppedBlocks.push(blockContent.trim().slice(0, 200));
      }
      if (result.warning) {
        warnings.push(result.warning);
      }
    }

    // ── Fallback : détection de délégation inline non structurée ─────────────
    // Si aucun bloc structuré mais que l'agent a écrit "CIBLE: test" en prose,
    // on tente un parsing ligne par ligne comme dernier recours.
    if (blockIndex === 0) {
      const fallback = this.parseFallbackInline(normalized, fromRole);
      if (fallback) {
        delegations.push({ ...fallback, blockIndex: 0 });
        log.info(`[${fromRole}] Délégation détectée via fallback inline`);
      } else {
        log.debug(`Aucun bloc DÉLÉGATION trouvé dans la sortie de [${fromRole}]`);
      }
    } else {
      log.info(
        `[${fromRole}] ${delegations.length}/${blockIndex} délégation(s) valide(s)`
      );
    }

    return { delegations, warnings, droppedBlocks };
  }

  // ─── Parsing d'un bloc structuré ──────────────────────────────────────────

  private parseBlock(
    content: string,
    fromRole: AgentRole,
    blockIndex: number
  ): { delegation?: ParsedDelegation; warning?: string } {
    const lines = content.split("\n").map((l) => l.trim()).filter(Boolean);
    const fields = this.extractFields(lines);

    // CIBLE (obligatoire)
    const cibleRaw = fields["cible"] ?? fields["target"] ?? fields["agent"] ?? fields["destinataire"];
    if (!cibleRaw) {
      return { warning: `Bloc #${blockIndex}: champ CIBLE manquant. Champs reçus: ${Object.keys(fields).join(", ")}` };
    }

    const targetRole = this.normalizeRole(cibleRaw);
    const validRoles = getValidRoles();
    if (!targetRole || !validRoles.has(targetRole)) {
      return {
        warning: `Bloc #${blockIndex}: rôle "${cibleRaw}" invalide. Valides: ${[...validRoles].join(", ")}`,
      };
    }

    // Validation matrice (inclut support des agents personnalisés)
    if (!isDelegationAllowed(fromRole, targetRole)) {
      return {
        warning: `Bloc #${blockIndex}: [${fromRole}] → [${targetRole}] non autorisé par la matrice`,
      };
    }

    // RAISON (obligatoire)
    const reason =
      fields["raison"] ?? fields["reason"] ?? fields["motif"] ??
      fields["description"] ?? fields["tache"] ?? "";
    if (!reason) {
      return { warning: `Bloc #${blockIndex}: champ RAISON manquant. Champs reçus: ${Object.keys(fields).join(", ")}` };
    }

    // FICHIERS (optionnel)
    const filesRaw = fields["fichiers"] ?? fields["files"] ?? fields["fichier"] ?? fields["file"] ?? "";
    const files = filesRaw
      ? filesRaw.split(/[,;]/).map((f) => f.trim()).filter((f) => f.length > 0 && f.length < 200)
      : [];

    // PRIORITÉ (optionnel)
    const priorityRaw = (
      fields["priorite"] ?? fields["priority"] ?? "medium"
    ).toLowerCase() as TaskPriority;
    const priority: TaskPriority = VALID_PRIORITIES.has(priorityRaw) ? priorityRaw : "medium";

    // INSTRUCTIONS (optionnel)
    const instructions =
      fields["instructions"] ?? fields["instruction"] ??
      fields["notes"] ?? fields["note"] ?? undefined;

    log.debug(`Délégation #${blockIndex}: [${fromRole}] → [${targetRole}] "${reason.slice(0, 60)}"`);

    return {
      delegation: { targetRole, reason, files, priority, instructions: instructions || undefined, blockIndex },
    };
  }

  // ─── Fallback inline ──────────────────────────────────────────────────────
  // Détecte les délégations écrites en prose sans bloc ## formel.
  // Ex: "CIBLE: test\nRAISON: vérifier la régression"

  private parseFallbackInline(text: string, fromRole: AgentRole): Omit<ParsedDelegation, "blockIndex"> | null {
    const lines = text.split("\n");
    const fields = this.extractFields(lines.map((l) => l.trim()).filter(Boolean));

    const cibleRaw = fields["cible"] ?? fields["target"];
    if (!cibleRaw) return null;

    const targetRole = this.normalizeRole(cibleRaw);
    const validRoles = getValidRoles();
    if (!targetRole || !validRoles.has(targetRole)) return null;

    // Validation matrice (inclut support des agents personnalisés)
    if (!isDelegationAllowed(fromRole, targetRole)) return null;

    const reason = fields["raison"] ?? fields["reason"] ?? fields["motif"] ?? "";
    if (!reason) return null;

    const filesRaw = fields["fichiers"] ?? fields["files"] ?? "";
    const files = filesRaw ? filesRaw.split(/[,;]/).map((f) => f.trim()).filter(Boolean) : [];
    const priorityRaw = (fields["priorite"] ?? fields["priority"] ?? "medium").toLowerCase() as TaskPriority;

    return {
      targetRole,
      reason,
      files,
      priority: VALID_PRIORITIES.has(priorityRaw) ? priorityRaw : "medium",
      instructions: fields["instructions"] || undefined,
    };
  }

  // ─── Extraction champs clé: valeur ────────────────────────────────────────

  /**
   * Normalise un rôle produit par le LLM vers un identifiant AgentRole valide.
   * Tolère les variations comme "docs (agent documentation)", "test agent", "security-audit", etc.
   */
  private normalizeRole(raw: string): AgentRole | null {
    const cleaned = raw.toLowerCase().trim();
    const validRoles = getValidRoles();

    // Exact match direct
    if (validRoles.has(cleaned as AgentRole)) return cleaned as AgentRole;

    // Table d'alias — mappe les variantes connues vers le rôle canonique
    const ROLE_ALIASES: Record<string, AgentRole> = {
      // writer
      "redacteur": "writer",
      "rédacteur": "writer",
      "rédaction": "writer",
      "redaction": "writer",
      "agent rédacteur": "writer",
      "writer agent": "writer",
      "write": "writer",
      // formatter
      "mise en forme": "formatter",
      "formatage": "formatter",
      "format": "formatter",
      "formatter agent": "formatter",
      "agent formatter": "formatter",
      // researcher
      "recherche": "researcher",
      "research": "researcher",
      "chercheur": "researcher",
      "researcher agent": "researcher",
      "agent recherche": "researcher",
      // proofreader
      "correcteur": "proofreader",
      "correction": "proofreader",
      "relecture": "proofreader",
      "proofreader agent": "proofreader",
      "agent correcteur": "proofreader",
      // translator
      "traducteur": "translator",
      "traduction": "translator",
      "translate": "translator",
      "translator agent": "translator",
      "agent traducteur": "translator",
      // summarizer
      "synthese": "summarizer",
      "synthèse": "summarizer",
      "résumé": "summarizer",
      "resume": "summarizer",
      "summarizer agent": "summarizer",
      "agent synthèse": "summarizer",
      // planner
      "planificateur": "planner",
      "planification": "planner",
      "plan": "planner",
      "outline": "planner",
      "planner agent": "planner",
      "agent planificateur": "planner",
    };

    // Check alias exact
    if (ROLE_ALIASES[cleaned]) return ROLE_ALIASES[cleaned];

    // Pattern "role (description)" — extraire le premier mot avant la parenthèse
    const parenMatch = cleaned.match(/^(\w+)\s*\(/);
    if (parenMatch) {
      const prefix = parenMatch[1];
      if (validRoles.has(prefix as AgentRole)) return prefix as AgentRole;
      if (ROLE_ALIASES[prefix]) return ROLE_ALIASES[prefix];
    }

    // Pattern "role - description" ou "role : description"
    const dashMatch = cleaned.match(/^(\w+)\s*[-:–—]/);
    if (dashMatch) {
      const prefix = dashMatch[1];
      if (validRoles.has(prefix as AgentRole)) return prefix as AgentRole;
      if (ROLE_ALIASES[prefix]) return ROLE_ALIASES[prefix];
    }

    // Dernier recours : vérifier si un rôle valide est contenu dans le texte
    for (const role of validRoles) {
      if (cleaned.includes(role)) return role;
    }

    return null;
  }

  private extractFields(lines: string[]): Record<string, string> {
    const fields: Record<string, string> = {};

    for (const line of lines) {
      // Nettoyer: tirets markdown, étoiles, backticks
      const cleaned = line
        .replace(/^[-*•>]\s*/, "")
        .replace(/\*\*/g, "")
        .replace(/`/g, "")
        .trim();

      // Chercher "clé: valeur" ou "clé : valeur"
      // La clé peut contenir des lettres Unicode (PRIORITÉ, RAISON...)
      const colonIdx = cleaned.search(/\s*:/);
      if (colonIdx <= 0) continue;

      const key = cleaned
        .slice(0, colonIdx)
        .trim()
        .toLowerCase()
        // Normaliser les accents dans les clés (PRIORITÉ → priorite)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");

      const value = cleaned.slice(colonIdx + 1).replace(/^\s*:?\s*/, "").trim();

      if (key && value && key.length < 30) {
        fields[key] = value;
      }
    }

    return fields;
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const delegationParser = new DelegationParser();
