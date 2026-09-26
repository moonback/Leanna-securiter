import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { analyzeFileTaint } from "./scanners/TaintAnalyzer.js";
import { scanFileForSecrets } from "./scanners/SecretsScanner.js";
import { scanIacFile } from "./scanners/IacScanner.js";
import { buildSarifReport } from "./reporting/SarifBuilder.js";
import { buildCycloneDxSbom } from "./reporting/SbomBuilder.js";
import { computeRiskPriority, calculateSeverityTier } from "./findings/SeverityScorer.js";
import { computeFingerprint } from "./findings/Fingerprint.js";

describe("Leanna Security Engine", () => {
  it("TaintAnalyzer should detect SQL injection from query parameters", async () => {
    const maliciousCode = `
      app.get('/user', async (req, res) => {
        const userId = req.query.id;
        const sql = "SELECT * FROM users WHERE id = " + userId;
        const user = await db.query(sql);
        res.json(user);
      });
    `;

    const findings = await analyzeFileTaint("src/routes/user.ts", maliciousCode);
    assert.ok(findings.length >= 1, "Should find at least 1 SQL injection");
    const sqli = findings.find((f) => f.ruleId === "SAST-SQLI");
    assert.ok(sqli, "Should have SAST-SQLI finding");
    assert.equal(sqli.severity, "critical");
    assert.ok(sqli.taintFlow && sqli.taintFlow.length >= 2, "Should have taint flow steps");
    assert.equal(sqli.taintFlow[0].kind, "source");
    assert.equal(sqli.taintFlow[sqli.taintFlow.length - 1].kind, "sink");
  });

  it("TaintAnalyzer should detect Command Injection", async () => {
    const maliciousCode = `
      const { exec } = require('child_process');
      function pingHost(req, res) {
        const host = req.query.host;
        exec("ping -c 1 " + host, (err, out) => {
          res.send(out);
        });
      }
    `;

    const findings = await analyzeFileTaint("src/services/network.ts", maliciousCode);
    const cmdInj = findings.find((f) => f.ruleId === "SAST-CMD-INJECTION");
    assert.ok(cmdInj, "Should have SAST-CMD-INJECTION finding");
    assert.equal(cmdInj.severity, "critical");
  });

  it("SecretsScanner should detect API keys and private keys", async () => {
    const codeWithSecrets = `
      const awsKey = "AKIA1234567890ABCDEF";
      const ghToken = "ghp_123456789012345678901234567890123456";
    `;

    const findings = await scanFileForSecrets("config.ts", codeWithSecrets);
    assert.ok(findings.length >= 2, "Should detect AWS key and GitHub token");
    const aws = findings.find((f) => f.ruleId === "SEC-AWS-KEY");
    assert.ok(aws, "Should detect AWS Access Key");
  });

  it("IacScanner should detect Dockerfile and Kubernetes security flaws", async () => {
    const insecureDockerfile = `
      FROM node:latest
      WORKDIR /app
      COPY . .
      CMD ["npm", "start"]
    `;

    const dockerFindings = await scanIacFile("Dockerfile", insecureDockerfile);
    assert.ok(dockerFindings.some((f) => f.ruleId === "IAC-DOCKER-ROOT"), "Should flag missing USER");
    assert.ok(dockerFindings.some((f) => f.ruleId === "IAC-DOCKER-LATEST"), "Should flag :latest tag");

    const insecureK8s = `
      apiVersion: v1
      kind: Pod
      spec:
        containers:
        - name: app
          image: nginx
          securityContext:
            privileged: true
    `;
    const k8sFindings = await scanIacFile("pod.yaml", insecureK8s);
    assert.ok(k8sFindings.some((f) => f.ruleId === "IAC-K8S-PRIVILEGED"), "Should flag privileged: true");
  });

  it("SarifBuilder should generate valid SARIF 2.1.0 output", () => {
    const findings = [
      {
        id: "test-1",
        fingerprint: computeFingerprint({ filePath: "app.ts", ruleId: "SAST-SQLI", startLine: 10 }),
        ruleId: "SAST-SQLI",
        ruleName: "Injection SQL",
        title: "SQLi detected",
        description: "Unsanitized query",
        severity: "critical" as const,
        status: "open" as const,
        scanner: "sast" as const,
        cwe: ["CWE-89"],
        owasp: ["A03:2021-Injection"],
        location: {
          filePath: "app.ts",
          startLine: 10,
          snippet: "db.query(sql)",
        },
        cvssScore: 9.8,
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
      },
    ];

    const sarif = buildSarifReport(findings) as any;
    assert.equal(sarif.version, "2.1.0");
    assert.equal(sarif.runs.length, 1);
    assert.equal(sarif.runs[0].results.length, 1);
    assert.equal(sarif.runs[0].results[0].ruleId, "SAST-SQLI");
    assert.equal(sarif.runs[0].results[0].level, "error");
  });

  it("SbomBuilder should produce CycloneDX 1.5 JSON", () => {
    const sbom = buildCycloneDxSbom({
      projectName: "leanna-audit",
      projectVersion: "1.2.0",
      components: [
        { name: "express", version: "4.19.2", type: "library" },
        { name: "better-sqlite3", version: "11.8.1", type: "library" },
      ],
    }) as any;

    assert.equal(sbom.bomFormat, "CycloneDX");
    assert.equal(sbom.specVersion, "1.5");
    assert.equal(sbom.components.length, 2);
  });

  it("SeverityScorer should compute realistic risk priority", () => {
    const criticalKev = computeRiskPriority({
      cvssScore: 9.8,
      epssScore: 0.95,
      cisaKev: true,
      isInternetFacing: true,
    });
    assert.equal(criticalKev.urgency, "immediate");
    assert.ok(criticalKev.riskScore >= 90);

    const lowRisk = computeRiskPriority({
      cvssScore: 3.5,
      epssScore: 0.01,
      cisaKev: false,
    });
    assert.equal(lowRisk.urgency, "low");
  });

  it("Should have all specialized security agent roles registered as read-only", async () => {
    const { getAgentDefinition, roleCanWriteFiles } = await import("../agents/roles.js");
    const securityRoles = [
      "recon",
      "threat_modeler",
      "architect_sec",
      "sast_analyzer",
      "crypto_auditor",
      "auth_auditor",
      "secrets_hunter",
      "sca_analyzer",
      "sbom_builder",
      "iac_auditor",
      "triage",
      "poc_writer",
      "report_writer",
    ];

    for (const role of securityRoles) {
      const def = getAgentDefinition(role);
      assert.ok(def, `Role ${role} should be defined`);
      assert.equal(def.role, role);
      assert.equal(roleCanWriteFiles(role), false, `Role ${role} must be strictly read-only`);
    }
  });
});
