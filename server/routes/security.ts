import express from "express";
import path from "path";
import { securityOrchestrator } from "../security/orchestrator/SecurityOrchestrator.js";
import { getProjectRoot } from "../skills/codebaseHelpers.js";

export const securityRouter = express.Router();

/**
 * POST /api/security/scan
 * Lance un scan de sécurité sur le workspace actuel
 */
securityRouter.post("/scan", async (req, res) => {
  try {
    const { scanners, excludePaths, target } = req.body || {};
    const root = target || getProjectRoot() || process.cwd();

    const result = await securityOrchestrator.runScan(root, {
      scanners,
      excludePaths,
    });

    res.json({
      success: true,
      scanId: result.scanId,
      status: result.status,
      durationMs: result.durationMs,
      filesScanned: result.filesScanned,
      findingsCount: result.findingsCount,
      findings: result.findings,
      sbomCount: result.sbomComponents.length,
    });
  } catch (error) {
    console.error("[SecurityRouter] Erreur lors du scan :", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Erreur interne lors du scan",
    });
  }
});

/**
 * GET /api/security/scan/status
 * Récupère l'état du scan en cours ou du dernier scan
 */
securityRouter.get("/scan/status", (req, res) => {
  res.json(securityOrchestrator.getStatus());
});

/**
 * GET /api/security/findings
 * Liste toutes les vulnérabilités détectées
 */
securityRouter.get("/findings", (req, res) => {
  const { severity, scanner, status } = req.query as {
    severity?: any;
    scanner?: any;
    status?: any;
  };

  const findings = securityOrchestrator.getAllFindings({
    severity,
    scanner,
    status,
  });

  res.json({
    success: true,
    total: findings.length,
    findings,
  });
});

/**
 * GET /api/security/findings/:id
 * Détails complets d'une vulnérabilité (avec chemin taint, PoC, remediation)
 */
securityRouter.get("/findings/:id", (req, res) => {
  const finding = securityOrchestrator.getFindingById(req.params.id);
  if (!finding) {
    return res.status(404).json({ error: "Vulnérabilité introuvable" });
  }
  res.json(finding);
});

/**
 * PATCH /api/security/findings/:id/status
 * Met à jour le statut d'un finding (triage / faux positif / corrigé)
 */
securityRouter.patch("/findings/:id/status", (req, res) => {
  const { status } = req.body;
  if (!status) {
    return res.status(400).json({ error: "Champ 'status' requis" });
  }

  const updated = securityOrchestrator.updateFindingStatus(req.params.id, status);
  if (!updated) {
    return res.status(404).json({ error: "Vulnérabilité introuvable" });
  }

  res.json({ success: true, finding: updated });
});

/**
 * GET /api/security/attack-surface
 * Données du graphe de surface d'attaque
 */
securityRouter.get("/attack-surface", (req, res) => {
  try {
    const surface = securityOrchestrator.getAttackSurface();
    res.json(surface);
  } catch (err) {
    res.status(500).json({ error: "Échec de calcul de la surface d'attaque" });
  }
});

/**
 * POST /api/security/report
 * Génère un rapport d'audit au format demandé (SARIF, SBOM CycloneDX, JSON, Markdown)
 */
securityRouter.post("/report", (req, res) => {
  try {
    const { format = "sarif" } = req.body || {};
    const root = getProjectRoot() || process.cwd();

    if (format === "sarif") {
      const sarif = securityOrchestrator.generateSarifReport(root);
      return res.json({
        format: "sarif",
        mimeType: "application/json",
        filename: `audit-report-${Date.now()}.sarif`,
        content: sarif,
      });
    }

    if (format === "sbom" || format === "cyclonedx") {
      const sbom = securityOrchestrator.generateCycloneDxSbom(
        path.basename(root),
        "1.0.0"
      );
      return res.json({
        format: "cyclonedx",
        mimeType: "application/json",
        filename: `sbom-cyclonedx-${Date.now()}.json`,
        content: sbom,
      });
    }

    if (format === "markdown") {
      const findings = securityOrchestrator.getAllFindings();
      let md = `# Rapport d'Audit de Sécurité - Leanna\n\n`;
      md += `*Généré le ${new Date().toLocaleString()}*\n\n`;
      md += `## Synthèse des vulnérabilités (${findings.length} détectées)\n\n`;
      md += `| Sévérité | Titre | Fichier | Règle |\n|---|---|---|---|\n`;

      findings.forEach((f) => {
        md += `| **${f.severity.toUpperCase()}** | ${f.title} | \`${f.location.filePath}:${f.location.startLine}\` | ${f.ruleId} |\n`;
      });

      return res.json({
        format: "markdown",
        mimeType: "text/markdown",
        filename: `rapport-audit-${Date.now()}.md`,
        content: md,
      });
    }

    const findings = securityOrchestrator.getAllFindings();
    res.json({
      format: "json",
      timestamp: new Date().toISOString(),
      findings,
    });
  } catch (err) {
    console.error("[SecurityRouter] Erreur génération rapport :", err);
    res.status(500).json({ error: "Échec de génération du rapport" });
  }
});
