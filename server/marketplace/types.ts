/**
 * Types et schémas Zod pour le Marketplace d'agents et de skills Leanna.
 *
 * Un "paquet" Marketplace encapsule soit un agent, soit un skill (ou les deux),
 * avec ses métadonnées de versioning, notation communautaire et résultats
 * de validation de sécurité automatisée.
 */

import { z } from "zod";

// ═══════════════════════════════════════════════════════════════════════════════
// Énumérations
// ═══════════════════════════════════════════════════════════════════════════════

/** Type de contenu d'un paquet */
export type MarketplacePackageType = "agent" | "skill" | "bundle";

/** Catégorie fonctionnelle */
export type MarketplaceCategory =
  | "code"        // Génération / refactoring de code
  | "devops"      // CI/CD, Docker, cloud
  | "web"         // Scraping, navigation, API
  | "data"        // Analyse, transformation, BDD
  | "writing"     // Rédaction, traduction, résumé
  | "security"    // Audit, CVE, cryptographie
  | "productivity"// Planification, automatisation
  | "ai"          // Orchestration, prompt engineering
  | "other";

/** Niveau de confiance de la validation sécurité */
export type SecurityTrustLevel = "verified" | "community" | "unreviewed" | "flagged";

// ═══════════════════════════════════════════════════════════════════════════════
// Interfaces principales
// ═══════════════════════════════════════════════════════════════════════════════

/** Paramètre d'un skill inclus dans un paquet */
export interface PackageSkillParam {
  name: string;
  type: "STRING" | "NUMBER" | "BOOLEAN" | "ARRAY";
  description: string;
  required: boolean;
}

/** Définition d'un skill exportable */
export interface PackageSkillDefinition {
  name: string;
  description: string;
  parameters: PackageSkillParam[];
  instruction: string;
  category: string;
  icon: string;
}

/** Définition d'un agent exportable */
export interface PackageAgentDefinition {
  name: string;
  role: string;
  description: string;
  systemPrompt: string;
  capabilities: string[];
  tools: string[];
  maxConcurrency: number;
  defaultTimeoutMs: number;
  triggerKeywords: string[];
  avatar?: string;
  color?: string;
  temperature?: number;
  maxTokens?: number;
  model?: string;
  autoDelegate?: boolean;
}

/** Rapport de validation sécurité automatisée */
export interface SecurityReport {
  /** Niveau de confiance global */
  trustLevel: SecurityTrustLevel;
  /** Date de la dernière analyse */
  analyzedAt: string;
  /** Score de sécurité (0–100) */
  score: number;
  /** Liste des avertissements */
  warnings: string[];
  /** Liste des flags critiques */
  flags: string[];
  /** Résumé lisible */
  summary: string;
}

/** Avis d'un utilisateur communautaire */
export interface MarketplaceReview {
  id: string;
  author: string;
  rating: number; // 1–5
  comment: string;
  createdAt: string;
  helpful: number; // votes "utile"
}

/** Statistiques d'utilisation */
export interface MarketplaceStats {
  downloads: number;
  installs: number;
  rating: number;      // moyenne 0–5
  reviewCount: number;
  weeklyDownloads: number;
}

/**
 * Un paquet Marketplace complet.
 * Représente une entrée du registre public.
 */
export interface MarketplacePackage {
  /** Identifiant unique du paquet (slug, ex: "code-reviewer-pro") */
  id: string;
  /** Nom affiché */
  name: string;
  /** Description courte (≤ 200 caractères) */
  description: string;
  /** Description longue / README en Markdown */
  readme?: string;
  /** Type de contenu */
  type: MarketplacePackageType;
  /** Catégorie principale */
  category: MarketplaceCategory;
  /** Tags de recherche */
  tags: string[];
  /** Version sémantique actuelle (ex: "1.2.3") */
  version: string;
  /** Historique des versions */
  versions: string[];
  /** Auteur / pseudo */
  author: string;
  /** URL avatar de l'auteur */
  authorAvatar?: string;
  /** Licence (ex: "MIT", "Apache-2.0") */
  license: string;
  /** URL du dépôt source */
  repositoryUrl?: string;
  /** Emoji avatar du paquet */
  avatar: string;
  /** Couleur principale (hex) */
  color: string;
  /** Agent inclus (si type "agent" ou "bundle") */
  agent?: PackageAgentDefinition;
  /** Skills inclus (si type "skill" ou "bundle") */
  skills?: PackageSkillDefinition[];
  /** Rapport de sécurité */
  security: SecurityReport;
  /** Statistiques */
  stats: MarketplaceStats;
  /** Avis communautaires */
  reviews: MarketplaceReview[];
  /** Date de publication */
  publishedAt: string;
  /** Date de mise à jour */
  updatedAt: string;
  /** Mis en avant / featured */
  featured: boolean;
  /** Vérifié par l'équipe Leanna */
  verified: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Schémas Zod
// ═══════════════════════════════════════════════════════════════════════════════

export const MarketplaceSearchSchema = z.object({
  query: z.string().max(200).optional(),
  type: z.enum(["agent", "skill", "bundle"]).optional(),
  category: z
    .enum(["code", "devops", "web", "data", "writing", "security", "productivity", "ai", "other"])
    .optional(),
  tags: z.array(z.string()).optional(),
  sort: z.enum(["popular", "recent", "rating", "installs"]).optional().default("popular"),
  page: z.number().int().min(1).optional().default(1),
  limit: z.number().int().min(1).max(50).optional().default(20),
  verified: z.boolean().optional(),
  featured: z.boolean().optional(),
});

export type MarketplaceSearchParams = z.infer<typeof MarketplaceSearchSchema>;

export const InstallPackageSchema = z.object({
  packageId: z.string().min(1, "ID du paquet requis"),
  version: z.string().optional(),
});

export type InstallPackageParams = z.infer<typeof InstallPackageSchema>;

export const RatePackageSchema = z.object({
  packageId: z.string().min(1),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(1000).optional().default(""),
  author: z.string().min(1).max(60).default("Utilisateur anonyme"),
});

export type RatePackageParams = z.infer<typeof RatePackageSchema>;

export const PublishPackageSchema = z.object({
  name: z.string().min(2).max(80),
  description: z.string().min(10).max(200),
  readme: z.string().max(10_000).optional(),
  type: z.enum(["agent", "skill", "bundle"]),
  category: z
    .enum(["code", "devops", "web", "data", "writing", "security", "productivity", "ai", "other"])
    .default("other"),
  tags: z.array(z.string().max(30)).max(10).default([]),
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/, "Format semver requis (ex: 1.0.0)")
    .default("1.0.0"),
  author: z.string().min(1).max(60),
  license: z.string().max(30).default("MIT"),
  repositoryUrl: z.string().url().optional(),
  avatar: z.string().max(10).default("🤖"),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Couleur hex requise")
    .default("#6366f1"),
  agent: z
    .object({
      name: z.string().min(1),
      role: z.string().min(1).regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/),
      description: z.string().optional().default(""),
      systemPrompt: z.string().optional().default(""),
      capabilities: z.array(z.string()).optional().default([]),
      tools: z.array(z.string()).optional().default([]),
      maxConcurrency: z.number().int().min(1).max(10).optional().default(2),
      defaultTimeoutMs: z.number().int().min(1000).max(600_000).optional().default(60_000),
      triggerKeywords: z.array(z.string()).optional().default([]),
      avatar: z.string().optional(),
      color: z.string().optional(),
      temperature: z.number().min(0).max(2).optional(),
      maxTokens: z.number().int().optional(),
      model: z.string().optional(),
      autoDelegate: z.boolean().optional(),
    })
    .optional(),
  skills: z
    .array(
      z.object({
        name: z
          .string()
          .min(1)
          .max(50)
          .regex(/^[a-z0-9_]+$/, "Nom skill: snake_case uniquement"),
        description: z.string().optional().default(""),
        parameters: z
          .array(
            z.object({
              name: z.string().min(1),
              type: z.enum(["STRING", "NUMBER", "BOOLEAN", "ARRAY"]),
              description: z.string().optional().default(""),
              required: z.boolean().default(false),
            })
          )
          .optional()
          .default([]),
        instruction: z.string().min(1),
        category: z.string().optional().default("custom"),
        icon: z.string().optional().default("Zap"),
      })
    )
    .optional()
    .default([]),
});

export type PublishPackageParams = z.infer<typeof PublishPackageSchema>;

/** Résultat d'installation */
export interface InstallResult {
  success: boolean;
  packageId: string;
  agentInstalled?: boolean;
  skillsInstalled?: number;
  warnings?: string[];
  error?: string;
}

/** Résultat de recherche paginé */
export interface MarketplaceSearchResult {
  packages: MarketplacePackage[];
  total: number;
  page: number;
  totalPages: number;
}
