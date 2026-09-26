/**
 * RichDocument Skill — Création et affichage de documents riches par Leanna
 *
 * Blocs supportés :
 *   table, bar_chart, line_chart, area_chart, pie_chart,
 *   card, list, text, code, progress, timeline, stat_grid
 */

import fs from "fs";
import path from "path";
import { Skill } from "./base.js";
import { resolveSandboxWriteTarget } from "./codebaseHelpers.js";
import { markFileModified } from "../utils/sandbox.js";

// ─── Types (miroir de RichDocumentViewer.tsx) ─────────────────────────────────

type RichBlockType =
  | "table" | "bar_chart" | "line_chart" | "area_chart" | "pie_chart"
  | "card" | "list" | "text" | "code" | "progress" | "timeline" | "stat_grid";

interface RichBlock {
  type: RichBlockType;
  [key: string]: any;
}

interface RichDocument {
  title: string;
  subtitle?: string;
  createdAt: string;
  blocks: RichBlock[];
}

// ─── Validation ───────────────────────────────────────────────────────────────

function validateBlock(block: any, index: number): { ok: boolean; error?: string } {
  if (!block || typeof block !== "object") {
    return { ok: false, error: `Bloc ${index}: doit être un objet` };
  }

  const validTypes: RichBlockType[] = [
    "table", "bar_chart", "line_chart", "area_chart", "pie_chart",
    "card", "list", "text", "code", "progress", "timeline", "stat_grid",
  ];

  if (!validTypes.includes(block.type)) {
    return {
      ok: false,
      error: `Bloc ${index}: type "${block.type}" invalide. Types valides: ${validTypes.join(", ")}`,
    };
  }

  switch (block.type as RichBlockType) {
    case "table":
      if (!Array.isArray(block.columns) || block.columns.length === 0)
        return { ok: false, error: `Bloc ${index} (table): "columns" requis (tableau non vide)` };
      if (!Array.isArray(block.rows))
        return { ok: false, error: `Bloc ${index} (table): "rows" requis (tableau de tableaux)` };
      break;

    case "bar_chart":
    case "line_chart":
    case "area_chart":
      if (!Array.isArray(block.data) || block.data.length === 0)
        return { ok: false, error: `Bloc ${index} (${block.type}): "data" requis (tableau non vide avec champ "label")` };
      if (!Array.isArray(block.series) || block.series.length === 0)
        return { ok: false, error: `Bloc ${index} (${block.type}): "series" requis (ex: [{"key":"valeur"}])` };
      break;

    case "pie_chart":
      if (!Array.isArray(block.data) || block.data.length === 0)
        return { ok: false, error: `Bloc ${index} (pie_chart): "data" requis (tableau avec "label" et "value")` };
      break;

    case "card":
      if (!Array.isArray(block.fields) || block.fields.length === 0)
        return { ok: false, error: `Bloc ${index} (card): "fields" requis (tableau avec "label" et "value")` };
      break;

    case "list":
      if (!Array.isArray(block.items) || block.items.length === 0)
        return { ok: false, error: `Bloc ${index} (list): "items" requis (tableau avec "text")` };
      break;

    case "text":
      if (typeof block.content !== "string" || !block.content.trim())
        return { ok: false, error: `Bloc ${index} (text): "content" requis (chaîne non vide)` };
      break;

    case "code":
      if (typeof block.content !== "string" || !block.content.trim())
        return { ok: false, error: `Bloc ${index} (code): "content" requis (chaîne non vide)` };
      break;

    case "progress":
      if (!Array.isArray(block.items) || block.items.length === 0)
        return { ok: false, error: `Bloc ${index} (progress): "items" requis (tableau avec "label" et "value")` };
      for (const item of block.items) {
        if (typeof item.label !== "string" || item.label.trim() === "")
          return { ok: false, error: `Bloc ${index} (progress): chaque item doit avoir un "label"` };
        if (typeof item.value !== "number")
          return { ok: false, error: `Bloc ${index} (progress): chaque item doit avoir un "value" numérique` };
      }
      break;

    case "timeline":
      if (!Array.isArray(block.events) || block.events.length === 0)
        return { ok: false, error: `Bloc ${index} (timeline): "events" requis (tableau avec "date" et "title")` };
      for (const ev of block.events) {
        if (typeof ev.title !== "string" || ev.title.trim() === "")
          return { ok: false, error: `Bloc ${index} (timeline): chaque événement doit avoir un "title"` };
        if (typeof ev.date !== "string" || ev.date.trim() === "")
          return { ok: false, error: `Bloc ${index} (timeline): chaque événement doit avoir une "date"` };
        if (ev.status && !["done", "current", "upcoming", "error"].includes(ev.status))
          return { ok: false, error: `Bloc ${index} (timeline): status valides: done, current, upcoming, error` };
      }
      break;

    case "stat_grid":
      if (!Array.isArray(block.items) || block.items.length === 0)
        return { ok: false, error: `Bloc ${index} (stat_grid): "items" requis (tableau avec "label" et "value")` };
      for (const item of block.items) {
        if (typeof item.label !== "string" || item.label.trim() === "")
          return { ok: false, error: `Bloc ${index} (stat_grid): chaque item doit avoir un "label"` };
        if (item.value === undefined || item.value === null)
          return { ok: false, error: `Bloc ${index} (stat_grid): chaque item doit avoir une "value"` };
      }
      if (block.columns !== undefined && ![2, 3, 4].includes(block.columns))
        return { ok: false, error: `Bloc ${index} (stat_grid): "columns" doit être 2, 3 ou 4` };
      break;
  }

  return { ok: true };
}

function buildDocumentPath(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9\u00C0-\u024F]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "document";
  return `docs/${slug}.rich.json`;
}

// ─── Skill ────────────────────────────────────────────────────────────────────

export const richDocumentSkill: Skill = {
  name: "richDocument",

  declarations: [
    {
      name: "create_rich_document",
      description: [
        "📊 Crée et affiche immédiatement un document riche interactif dans l'interface.",
        "Utilise cet outil pour présenter des données sous forme de tableaux, graphiques,",
        "courbes, camemberts, fiches, listes, code, progressions, chronologies ou statistiques.",
        "Beaucoup plus lisible qu'un message texte pour des données structurées.",
        "",
        "Types de blocs disponibles :",
        "• 'table'      — Tableau avec filtre intégré et export CSV",
        "• 'bar_chart'  — Graphique en barres (groupé ou empilé), taille S/M/L",
        "• 'line_chart' — Courbe / graphique linéaire, taille S/M/L",
        "• 'area_chart' — Graphique en aires (empilable), taille S/M/L",
        "• 'pie_chart'  — Camembert ou donut avec légende valeurs absolues + %",
        "• 'card'       — Fiche avec champs clé/valeur (KPI, stats)",
        "• 'list'       — Liste structurée avec sous-textes et badges",
        "• 'text'       — Bloc de texte Markdown (rendu automatiquement)",
        "• 'code'       — Bloc de code avec langage et bouton copie",
        "• 'progress'   — Barres de progression animées (valeur/max, unité, couleur)",
        "• 'timeline'   — Frise chronologique avec statuts (done/current/upcoming/error)",
        "• 'stat_grid'  — Grille de statistiques avec variations +/- et icônes",
        "",
        "Un document peut combiner plusieurs blocs de types différents.",
      ].join("\n"),
      parameters: {
        type: "OBJECT",
        properties: {
          title: {
            type: "STRING",
            description: "Titre principal du document (ex: 'Rapport des ventes Q3', 'Analyse des performances').",
          },
          subtitle: {
            type: "STRING",
            description: "Sous-titre optionnel (ex: 'Données du 1er janvier au 30 septembre 2024').",
          },
          blocks: {
            type: "ARRAY",
            description: [
              "Tableau de blocs de contenu. Chaque bloc a un champ 'type' obligatoire.",
              "",
              "── TABLE ──",
              '{ "type":"table", "title":"Ventes", "columns":["Produit","Q1","Q2"], "rows":[["Alpha",120,145],["Beta",89,110]] }',
              "",
              "── BAR_CHART ──",
              '{ "type":"bar_chart", "title":"CA mensuel", "height":"md", "stacked":false,',
              '  "data":[{"label":"Jan","ca":1200},{"label":"Fév","ca":1450}],',
              '  "series":[{"key":"ca","label":"Chiffre d\'affaires","color":"#6366f1"}] }',
              "",
              "── LINE_CHART ──",
              '{ "type":"line_chart", "title":"Évolution", "smooth":true, "height":"md",',
              '  "data":[{"label":"S1","users":200},{"label":"S2","users":340}],',
              '  "series":[{"key":"users","label":"Utilisateurs"}] }',
              "",
              "── AREA_CHART ──",
              '{ "type":"area_chart", "title":"Traffic", "height":"md",',
              '  "data":[{"label":"Lun","visits":500},{"label":"Mar","visits":620}],',
              '  "series":[{"key":"visits","color":"#22d3ee"}] }',
              "",
              "── PIE_CHART ──",
              '{ "type":"pie_chart", "title":"Parts de marché", "donut":true,',
              '  "data":[{"label":"Produit A","value":45},{"label":"Produit B","value":30},{"label":"Autres","value":25}] }',
              "",
              "── CARD ──",
              '{ "type":"card", "title":"Indicateurs clés", "badge":{"text":"✓ Objectif atteint","color":"#34d399"},',
              '  "fields":[{"label":"CA Total","value":"124 500 €","highlight":true},{"label":"Clients","value":"1 247"}] }',
              "",
              "── LIST ──",
              '{ "type":"list", "title":"Actions", "ordered":true,',
              '  "items":[{"text":"Optimiser","sub":"Réduction: 15%","badge":"Urgent"},{"text":"Former l\'équipe"}] }',
              "",
              "── TEXT (Markdown) ──",
              '{ "type":"text", "title":"Contexte", "content":"## Résumé\\n\\nCe rapport couvre **trois trimestres**..." }',
              "",
              "── CODE ──",
              '{ "type":"code", "title":"Exemple", "language":"typescript", "content":"const x = 42;\\nconsole.log(x);" }',
              "",
              "── PROGRESS ──",
              '{ "type":"progress", "title":"Avancement", "items":[',
              '  {"label":"Frontend","value":75,"max":100,"unit":"%","color":"#6366f1"},',
              '  {"label":"Backend","value":3200,"max":5000,"unit":"lignes"} ]}',
              "",
              "── TIMELINE ──",
              '{ "type":"timeline", "title":"Jalons", "events":[',
              '  {"date":"Jan 2024","title":"Lancement","status":"done","badge":"v1.0"},',
              '  {"date":"Mars 2024","title":"En cours","status":"current","description":"Intégration API"},',
              '  {"date":"Juin 2024","title":"Déploiement prod","status":"upcoming"} ]}',
              "",
              "── STAT_GRID ──",
              '{ "type":"stat_grid", "title":"KPIs", "columns":3, "items":[',
              '  {"label":"Revenus","value":124500,"unit":"€","change":12.3,"changeLabel":"vs mois dernier","color":"#34d399","icon":"💰"},',
              '  {"label":"Clients","value":1247,"change":-2.1,"color":"#6366f1","icon":"👥"},',
              '  {"label":"NPS","value":72,"change":0,"color":"#f59e0b","icon":"⭐"} ]}',
            ].join("\n"),
            items: { type: "OBJECT" },
          },
        },
        required: ["title", "blocks"],
      },
    },
  ],

  handleToolCall: async (name: string, args: any, context?: any) => {
    if (name !== "create_rich_document") {
      return { error: `Outil inconnu: ${name}` };
    }

    // ── Validation titre ──────────────────────────────────────────────────────
    const title = String(args.title ?? "").trim();
    if (!title) {
      return { error: "Le champ 'title' est requis." };
    }

    const blocks: RichBlock[] = Array.isArray(args.blocks) ? args.blocks : [];
    if (blocks.length === 0) {
      return { error: "Le document doit contenir au moins un bloc dans 'blocks'." };
    }

    // ── Validation des blocs ──────────────────────────────────────────────────
    const blockErrors: string[] = [];
    for (let i = 0; i < blocks.length; i++) {
      const result = validateBlock(blocks[i], i);
      if (!result.ok && result.error) blockErrors.push(result.error);
    }
    if (blockErrors.length > 0) {
      return {
        error: `Erreurs de validation dans les blocs :\n${blockErrors.join("\n")}`,
        hint: "Corrige les blocs indiqués et réessaie.",
      };
    }

    // ── Construction du document ──────────────────────────────────────────────
    const doc: RichDocument = {
      title,
      subtitle: args.subtitle ? String(args.subtitle).trim() : undefined,
      createdAt: new Date().toISOString(),
      blocks,
    };

    const documentPath = buildDocumentPath(title);
    const target = resolveSandboxWriteTarget(documentPath);
    if (!target) {
      return {
        error: "Impossible d'enregistrer le document : sandbox inactive ou chemin invalide.",
        hint: "Attends que le sandbox soit READY puis réessaie.",
      };
    }
    const content = JSON.stringify(doc, null, 2);
    await fs.promises.mkdir(path.dirname(target.sandboxPath), { recursive: true });
    await fs.promises.writeFile(target.sandboxPath, content, "utf-8");
    markFileModified(documentPath);

    // ── Émission vers le client ───────────────────────────────────────────────
    if (context?.emitIdeAction) {
      context.emitIdeAction({ type: "open-rich-document", document: doc, path: documentPath });
      context.emitIdeAction({ type: "file-changed", path: documentPath });
      console.log(
        `[RichDocument] "${title}" — ${blocks.length} bloc(s): ${blocks.map((b) => b.type).join(", ")}`
      );
    } else {
      console.warn("[RichDocument] emitIdeAction non disponible — document non affiché.");
    }

    return {
      status: "success",
      title,
      path: documentPath,
      blocks_count: blocks.length,
      block_types: blocks.map((b) => b.type),
      message: `Document "${title}" créé, enregistré dans ${documentPath} et affiché dans l'interface.`,
    };
  },
};
