/**
 * server/routes/security.ts
 * REST API for the Phase 4 SecurityOrchestrator.
 *
 * All routes are mounted at /api/security (see server.ts line ~610).
 *
 * Endpoints
 * ─────────
 *  GET    /status                       → orchestrator + queue + finding stats
 *  POST   /scan                         → trigger a new scan (queued)
 *  GET    /findings                     → list findings (filterable)
 *  GET    /findings/:id                 → single finding detail
 *  PATCH  /findings/:id/status          → triage update (status, rationale, author)
 *  GET    /sbom                         → SBOM as JSON array (SbomEntry[])
 *  GET    /attack-surface               → attack surface graph
 *  GET    /sarif                        → SARIF 2.1.0 blob download
 *  GET    /sbom/cyclonedx               → CycloneDX 1.5 blob download
 *  GET    /triage-audit                 → full audit log
 *  GET    /triage-audit/:findingId      → audit log for one finding
 *  POST   /report                       → markdown / JSON report (legacy compat)
 *  GET    /rules                        → list rule packs
 *  GET    /rules/:packId                → rules in a pack
 *  PATCH  /rules/:packId/toggle         → enable/disable a pack
 */

import express from "express";
import path from "path";
import { securityOrchestrator } from "../security/orchestrator/SecurityOrchestrator.js";
import { getProjectRoot } from "../skills/codebaseHelpers.js";
import { ruleEngine } from "../security/rules/RuleEngine.js";

export const securityRouter = express.Router();

// ─── GET /status ─────────────────────────────────────────────────────────────

securityRouter.get("/status", (_req, res) => {
  res.json(securityOrchestrator.getStatus());
});

// ─── POST /scan ───────────────────────────────────────────────────────────────

securityRouter.post("/scan", async (req, res) => {
  try {
    const {
      targetDir,
      target,           // legacy alias
      profile,
      triggerType,
      changedFiles,
      policyOverride,
      // legacy fields (backward compat)
      scanners,
      excludePaths,
      useSandbox,
    } = req.body || {};

    // Resolve target directory
    let root = targetDir || target;
    if (!root) {
      if (useSandbox !== false) {
        try {
          const { getSandboxRoot } = await import("../utils/sandbox.js");
          const fs = await import("fs");
          const sbPath = getSandboxRoot();
          if (fs.existsSync(sbPath)) root = sbPath;
        } catch { /* no sandbox */ }
      }
      if (!root) root = getProjectRoot() || process.cwd();
    }

    const result = await securityOrchestrator.runScan(root, {
      profile: profile ?? "standard",
      triggerType: triggerType ?? "api",
      changedFiles,
      policyOverride: policyOverride ?? (excludePaths ? { excludePaths } : undefined),
    });

    res.json({
      success: true,
      scanId:             result.scanId,
      targetPath:         result.targetPath,
      profile:            result.profile,
      triggerType:        result.triggerType,
      status:             result.status,
      blockingReason:     result.blockingReason,
      startTime:          result.startTime,
      endTime:            result.endTime,
      durationMs:         result.durationMs,
      filesScanned:       result.filesScanned,
      filesSkipped:       result.filesSkipped,
      findingsCount:      result.findingsCount,
      scaOnlineEnrichment: result.scaOnlineEnrichment,
      cacheSize:          result.cacheSize,
      // Include findings inline for small scans; clients can also fetch /findings
      findings:           result.findings,
      sbomCount:          result.sbomComponents.length,
    });
  } catch (error) {
    console.error("[SecurityRouter] Scan error:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Erreur interne lors du scan",
    });
  }
});

// Alias: GET /scan/status (legacy — keep for compatibility)
securityRouter.get("/scan/status", (_req, res) => {
  res.json(securityOrchestrator.getStatus());
});

// ─── GET /findings ────────────────────────────────────────────────────────────

securityRouter.get("/findings", (req, res) => {
  const { severity, scanner, status, q, cwe, kevOnly } = req.query as Record<string, string | undefined>;

  const findings = securityOrchestrator.getAllFindings({
    severity:   severity !== "all" ? severity as any : undefined,
    scanner:    scanner  !== "all" ? scanner  as any : undefined,
    status:     status   !== "all" ? status   as any : undefined,
    searchQuery: q,
    cwe,
    cisaKevOnly: kevOnly === "true",
  });

  res.json({ success: true, count: findings.length, findings });
});

// ─── GET /findings/:id ───────────────────────────────────────────────────────

securityRouter.get("/findings/:id", (req, res) => {
  const finding = securityOrchestrator.getFindingById(req.params.id);
  if (!finding) {
    res.status(404).json({ error: "Vulnérabilité introuvable" });
    return;
  }
  res.json(finding);
});

// ─── PATCH /findings/:id/status ──────────────────────────────────────────────

securityRouter.patch("/findings/:id/status", (req, res) => {
  const { status, rationale, author } = req.body ?? {};
  if (!status) {
    res.status(400).json({ error: "Champ 'status' requis" });
    return;
  }

  const ok = securityOrchestrator.updateFindingStatus(
    req.params.id,
    status,
    rationale,
    author,
  );

  if (!ok) {
    res.status(404).json({ error: "Vulnérabilité introuvable" });
    return;
  }

  const updated = securityOrchestrator.getFindingById(req.params.id);
  res.json(updated);
});

// ─── GET /sbom ───────────────────────────────────────────────────────────────
// Returns the SBOM as a flat JSON array of SbomComponent objects (SbomEntry[])

securityRouter.get("/sbom", (_req, res) => {
  const status = securityOrchestrator.getStatus();
  // The SBOM is embedded in the last scan result; access via generateCycloneDxSbom
  // For the table view we expose the raw components list.
  const cdx = securityOrchestrator.generateCycloneDxSbom("leanna", "1.0.0") as any;
  const components: unknown[] = cdx?.components ?? [];

  // Map CycloneDX component shape → SbomEntry (frontend)
  const sbomEntries = components.map((c: any) => ({
    name:         c.name,
    version:      c.version,
    license:      c.licenses?.[0]?.license?.id ?? c.licenses?.[0]?.expression,
    ecosystem:    c.purl?.split(":")[1] ?? "npm",
    cveCount:     c.vulnerabilities?.length ?? 0,
    maxCvss:      c.vulnerabilities?.reduce((m: number, v: any) => Math.max(m, v.ratings?.[0]?.score ?? 0), 0) || undefined,
    maxEpss:      c.vulnerabilities?.reduce((m: number, v: any) => Math.max(m, v.epss ?? 0), 0) || undefined,
    cisaKev:      c.vulnerabilities?.some((v: any) => v.cisaKev) ?? false,
    transitive:   c.scope === "optional" || c.scope === "excluded",
    fixedVersion: c.vulnerabilities?.[0]?.affects?.[0]?.versions?.find((v: any) => v.status === "unaffected")?.version,
  }));

  res.json(sbomEntries);
});

// ─── GET /attack-surface ─────────────────────────────────────────────────────

securityRouter.get("/attack-surface", (_req, res) => {
  try {
    const raw = securityOrchestrator.getAttackSurface();
    const typeMap: Record<string, "entry" | "propagation" | "sink" | "safe"> = {
      entrypoint: "entry",
      service: "propagation",
      database: "sink",
      storage: "sink",
      external: "propagation",
    };
    const nodes = raw.nodes.map((n) => ({
      id: n.id,
      label: n.label,
      type: typeMap[n.type] || "propagation",
      findings: n.vulnCount > 0 ? [`${n.vulnCount} vulnérabilité(s)`] : undefined,
    }));
    const edges = raw.edges.map((e) => ({
      from: e.source,
      to: e.target,
      type: e.tainted ? "taint" : "data_flow",
    }));
    const graph = {
      nodes,
      edges,
      totalEntryPoints: raw.summary.totalEntrypoints,
      totalSinks: raw.nodes.filter((n) => n.type === "database" || n.type === "storage").length,
      taintedPaths: raw.summary.criticalPaths,
    };
    res.json({ graph, raw });
  } catch (err) {
    res.status(500).json({ error: "Échec de calcul de la surface d'attaque" });
  }
});

// ─── GET /sarif (blob download) ──────────────────────────────────────────────

securityRouter.get("/sarif", (req, res) => {
  try {
    const root = getProjectRoot() || process.cwd();
    const sarif = securityOrchestrator.generateSarifReport(root);
    const filename = `leanna-sarif-${Date.now()}.sarif.json`;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.json(sarif);
  } catch (err) {
    res.status(500).json({ error: "Erreur génération SARIF" });
  }
});

// ─── GET /sbom/cyclonedx (blob download) ─────────────────────────────────────

securityRouter.get("/sbom/cyclonedx", (req, res) => {
  try {
    const root = getProjectRoot() || process.cwd();
    const projectName = path.basename(root);
    const cdx = securityOrchestrator.generateCycloneDxSbom(projectName, "1.0.0");
    const filename = `leanna-sbom-${Date.now()}.cdx.json`;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.json(cdx);
  } catch (err) {
    res.status(500).json({ error: "Erreur génération CycloneDX SBOM" });
  }
});

// ─── GET /triage-audit ───────────────────────────────────────────────────────

securityRouter.get("/triage-audit", (_req, res) => {
  res.json(securityOrchestrator.getTriageAuditLog());
});

securityRouter.get("/triage-audit/:findingId", (req, res) => {
  res.json(securityOrchestrator.getTriageAuditLog(req.params.findingId));
});

// ─── GET /stats ───────────────────────────────────────────────────────────────

securityRouter.get("/stats", (_req, res) => {
  res.json(securityOrchestrator.getFindingStats());
});

// ─── POST /report (legacy markdown/JSON compat) ──────────────────────────────

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
      const sbom = securityOrchestrator.generateCycloneDxSbom(path.basename(root), "1.0.0");
      return res.json({
        format: "cyclonedx",
        mimeType: "application/json",
        filename: `sbom-cyclonedx-${Date.now()}.json`,
        content: sbom,
      });
    }

    if (format === "html" || format === "pdf") {
      const findings = securityOrchestrator.getAllFindings();
      const stats = securityOrchestrator.getFindingStats();
      const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>Rapport d'Audit de Sécurité — Leanna</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0b1120; color: #f8fafc; padding: 32px; margin: 0; line-height: 1.6; }
    .container { max-width: 900px; margin: 0 auto; background: #1e293b; border-radius: 16px; border: 1px solid #334155; padding: 32px; }
    h1 { color: #38bdf8; margin-top: 0; font-size: 24px; }
    .stats { display: flex; gap: 16px; margin: 24px 0; }
    .card { background: #0f172a; padding: 12px 20px; border-radius: 12px; border: 1px solid #334155; flex: 1; text-align: center; }
    .crit { color: #ef4444; font-size: 24px; font-weight: bold; }
    .high { color: #f97316; font-size: 24px; font-weight: bold; }
    .med { color: #f59e0b; font-size: 24px; font-weight: bold; }
    .tot { color: #38bdf8; font-size: 24px; font-weight: bold; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 13px; }
    th { text-align: left; padding: 10px; border-bottom: 2px solid #334155; color: #94a3b8; }
    td { padding: 10px; border-bottom: 1px solid #334155; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 6px; font-weight: bold; font-size: 10px; text-transform: uppercase; }
    .badge-critical { background: #dc262625; color: #ef4444; border: 1px solid #dc262650; }
    .badge-high { background: #ea580c25; color: #f97316; border: 1px solid #ea580c50; }
    .badge-medium { background: #d9770625; color: #f59e0b; border: 1px solid #d9770650; }
    .badge-low { background: #2563eb25; color: #3b82f6; border: 1px solid #2563eb50; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🛡️ Rapport d'Audit de Sécurité</h1>
    <p style="color: #94a3b8; font-size: 12px;">Généré le ${new Date().toLocaleString('fr-FR')} par Leanna Security Orchestrator</p>
    <div class="stats">
      <div class="card"><div class="crit">${stats.critical}</div><div style="font-size:11px;color:#94a3b8;">Critiques</div></div>
      <div class="card"><div class="high">${stats.high}</div><div style="font-size:11px;color:#94a3b8;">Hautes</div></div>
      <div class="card"><div class="med">${stats.medium}</div><div style="font-size:11px;color:#94a3b8;">Moyennes</div></div>
      <div class="card"><div class="tot">${stats.total}</div><div style="font-size:11px;color:#94a3b8;">Total</div></div>
    </div>
    <h2>Détail des vulnérabilités (${findings.length})</h2>
    <table>
      <thead>
        <tr><th>Sévérité</th><th>Titre</th><th>Scanner</th><th>Emplacement</th><th>CWE</th></tr>
      </thead>
      <tbody>
        ${findings.map(f => `
          <tr>
            <td><span class="badge badge-${f.severity}">${f.severity}</span></td>
            <td><strong>${f.title}</strong><br><small style="color:#94a3b8;">${f.description}</small></td>
            <td>${f.scanner.toUpperCase()}</td>
            <td><code>${f.location.filePath}:${f.location.startLine ?? ''}</code></td>
            <td>${f.cwe.join(', ')}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  </div>
</body>
</html>`;
      return res.json({
        format: format,
        mimeType: "text/html",
        filename: `rapport-audit-${Date.now()}.html`,
        content: html,
      });
    }

    if (format === "markdown") {
      const findings = securityOrchestrator.getAllFindings();
      let md = `# Rapport d'Audit de Sécurité - Leanna\n\n`;
      md += `*Généré le ${new Date().toLocaleString()}*\n\n`;
      md += `## Synthèse (${findings.length} findings)\n\n`;
      md += `| Sévérité | Titre | Fichier | Règle |\n|---|---|---|---|\n`;
      findings.forEach((f) => {
        md += `| **${f.severity.toUpperCase()}** | ${f.title} | \`${f.location.filePath}:${f.location.startLine ?? ""}\` | ${f.ruleId} |\n`;
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
      mimeType: "application/json",
      filename: `security-findings-${Date.now()}.json`,
      content: { timestamp: new Date().toISOString(), total: findings.length, findings },
    });
  } catch (err) {
    console.error("[SecurityRouter] Report error:", err);
    res.status(500).json({ error: "Échec de génération du rapport" });
  }
});

// ─── Rules API ────────────────────────────────────────────────────────────────

securityRouter.get("/rules", (_req, res) => {
  try {
    const packs = ruleEngine.listPacks();
    const total = ruleEngine.getAllEnabledRules().length;
    res.json({ success: true, total, packs });
  } catch (err) {
    res.status(500).json({ error: "Erreur lors de la récupération des règles" });
  }
});

securityRouter.get("/rules/:packId", (req, res) => {
  const { packId } = req.params;
  const rules = ruleEngine.getPackRules(packId);
  if (rules.length === 0) {
    const exists = ruleEngine.listPacks().some((p) => p.id === packId);
    if (!exists) { res.status(404).json({ error: "Pack introuvable" }); return; }
  }
  res.json({ success: true, packId, rules });
});

securityRouter.patch("/rules/:packId/toggle", (req, res) => {
  const { packId } = req.params;
  const { enabled } = req.body ?? {};
  if (typeof enabled !== "boolean") {
    res.status(400).json({ error: "Champ 'enabled' (boolean) requis" });
    return;
  }
  const ok = ruleEngine.setPackEnabled(packId, enabled);
  if (!ok) { res.status(404).json({ error: "Pack introuvable" }); return; }
  res.json({ success: true, packId, enabled });
});
