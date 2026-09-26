import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { setSelfRoot } from "../../utils/selfRoot.js";
import { securitySkill } from "./index.js";
import { calculateCvss31 } from "./score/cvssCalculator.js";
import { computePriorityScore } from "./score/priorityEngine.js";
import { exportToSarif } from "./normalize/sarifBuilder.js";
import { scanFileSecrets } from "./secrets/regexScanner.js";
import { scanInjections } from "./sast/injectionScanner.js";
import { scanXss } from "./sast/xssScanner.js";
import { scanPathTraversal } from "./sast/pathTraversalScanner.js";

setSelfRoot(path.resolve(process.cwd()));

test("securitySkill declares modular tools", () => {
  const toolNames = securitySkill.declarations.map((d) => d.name);
  assert.ok(toolNames.includes("security_audit"));
  assert.ok(toolNames.includes("security_sast"));
  assert.ok(toolNames.includes("security_sca"));
});

test("cvssCalculator computes exact CVSS v3.1 scores", () => {
  // Vecteur critique type Log4Shell / RCE
  const resCritical = calculateCvss31("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H");
  assert.equal(resCritical.score, 9.8);
  assert.equal(resCritical.severity, "critical");

  // Vecteur Scope Changed
  const resScope = calculateCvss31("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H");
  assert.equal(resScope.score, 10.0);
  assert.equal(resScope.severity, "critical");

  // Vecteur moyen
  const resMedium = calculateCvss31("CVSS:3.1/AV:L/AC:H/PR:H/UI:R/S:U/C:L/I:L/A:N");
  assert.ok(resMedium.score < 5.0);
  assert.equal(resMedium.severity, "low");
});

test("priorityEngine computes SLA and priority score correctly", () => {
  const p0 = computePriorityScore({ cvssScore: 9.8, epssScore: 0.85, cisaKev: true });
  assert.equal(p0.urgency, "p0_immediate");
  assert.equal(p0.slaHours, 24);

  const p1 = computePriorityScore({ cvssScore: 7.5, epssScore: 0.35, cisaKev: false });
  assert.equal(p1.urgency, "p1_high");
  assert.equal(p1.slaHours, 72);

  const p3 = computePriorityScore({ cvssScore: 3.0, epssScore: 0.01, cisaKev: false });
  assert.equal(p3.urgency, "p3_low");
});

test("sast scanners detect real vulnerabilities in test code snippets", () => {
  const sqlSnippet = 'const q = `SELECT * FROM users WHERE id = ${req.query.id}`;';
  const sqli = scanInjections(sqlSnippet, "test.ts");
  assert.ok(sqli.length > 0);
  assert.equal(sqli[0].ruleId, "CWE-89");

  const xssSnippet = '<div dangerouslySetInnerHTML={{ __html: userInput }} />';
  const xss = scanXss(xssSnippet, "view.tsx");
  assert.ok(xss.length > 0);
  assert.equal(xss[0].ruleId, "CWE-79");

  const pathSnippet = 'fs.readFile(path.join("/uploads", req.params.filename));';
  const pathTrav = scanPathTraversal(pathSnippet, "api.ts");
  assert.ok(pathTrav.length > 0);
  assert.equal(pathTrav[0].ruleId, "CWE-22");
});

test("secrets scanner detects credentials and respects allowlist", () => {
  const fakeKey = 'const key = "AKIA1234567890ABCDEF";';
  const found = scanFileSecrets(fakeKey, "config.ts");
  assert.ok(found.length > 0);
  assert.equal(found[0].ruleId, "SEC-AWS-KEY");

  // In a test file, it should be ignored by allowlist
  const ignoredInTest = scanFileSecrets(fakeKey, "config.test.ts");
  assert.equal(ignoredInTest.length, 0);
});

test("sarifBuilder generates standard OASIS 2.1.0 schema", () => {
  const sqli = scanInjections('db.query("SELECT * " + input);', "api.ts");
  const sarif: any = exportToSarif(sqli);
  assert.equal(sarif.version, "2.1.0");
  assert.ok(Array.isArray(sarif.runs));
  assert.ok(sarif.runs[0].results.length > 0);
  assert.equal(sarif.runs[0].results[0].ruleId, "CWE-89");
});

test("security_sast tool call executes successfully via Skill interface", async () => {
  const res = await securitySkill.handleToolCall("security_sast", {
    filePath: "package.json",
  });
  assert.equal(res.status, "success");
  assert.equal(typeof res.totalFindings, "number");
});
