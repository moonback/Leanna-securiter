import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runDastScan } from "./DastScanner.js";
import type { Finding } from "../findings/Finding.js";

// ---------------------------------------------------------------------------
// Helpers : fabrique de réponses HTTP simulées (aucun réseau réel)
// ---------------------------------------------------------------------------

function mockResponse(init: {
  status?: number;
  headers?: Record<string, string>;
}): Response {
  const status = init.status ?? 200;
  const map = new Map<string, string>();
  for (const [k, v] of Object.entries(init.headers ?? {})) {
    map.set(k.toLowerCase(), v);
  }
  // Objet minimal compatible avec l'usage du scanner (status + headers.get).
  return {
    status,
    headers: {
      get: (name: string) => map.get(name.toLowerCase()) ?? null,
    },
  } as unknown as Response;
}

/** fetch simulé : enregistre les requêtes reçues et renvoie une réponse fixe. */
function makeFetch(
  handler: (url: string, method: string) => Response | null,
): { fetchImpl: typeof fetch; calls: Array<{ url: string; method: string }> } {
  const calls: Array<{ url: string; method: string }> = [];
  const fetchImpl = (async (input: any, opts: any) => {
    const url = String(input);
    const method = String(opts?.method ?? "GET");
    calls.push({ url, method });
    const res = handler(url, method);
    if (!res) throw new Error("network error (simulé)");
    return res;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function makeSastFinding(partial: Partial<Finding>): Finding {
  return {
    id: partial.id ?? "sast-1",
    fingerprint: partial.fingerprint ?? "fp-sast-1",
    ruleId: partial.ruleId ?? "SAST-SSRF",
    ruleName: "SSRF",
    title: partial.title ?? "SSRF dans users.ts",
    description: "desc",
    severity: partial.severity ?? "high",
    status: "open",
    scanner: "sast",
    cwe: ["CWE-918"],
    owasp: ["A10:2021-Server-Side Request Forgery (SSRF)"],
    location: { filePath: partial.location?.filePath ?? "server/routes/users.ts", startLine: 10 },
    cvssScore: 8.6,
    firstSeen: new Date().toISOString(),
    lastSeen: new Date().toISOString(),
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DastScanner (non destructif, opt-in)", () => {
  it("détecte les en-têtes de sécurité manquants sur la racine", async () => {
    const { fetchImpl } = makeFetch(() => mockResponse({ status: 200, headers: {} }));

    const res = await runDastScan({ target: "http://localhost:3000", fetchImpl });

    const headerFindings = res.findings.filter((f) =>
      f.ruleId.startsWith("DAST-MISSING-HEADER-"),
    );
    assert.ok(headerFindings.length >= 4, "au moins 4 en-têtes de sécurité manquants");
    assert.ok(res.findings.every((f) => f.scanner === "dast"));
    assert.equal(res.requestsSent, 1);
  });

  it("n'émet JAMAIS de requête mutante (méthodes sûres uniquement)", async () => {
    const { fetchImpl, calls } = makeFetch(() => mockResponse({ status: 200, headers: {} }));

    await runDastScan({
      target: "http://localhost:3000",
      endpoints: [
        { path: "/a", method: "GET" },
        { path: "/b", method: "POST" }, // doit être ignoré (non sûr)
        { path: "/c", method: "DELETE" }, // doit être ignoré
        { path: "/d", method: "OPTIONS" },
      ],
      fetchImpl,
    });

    const methods = new Set(calls.map((c) => c.method));
    assert.ok(!methods.has("POST"), "aucune requête POST");
    assert.ok(!methods.has("DELETE"), "aucune requête DELETE");
    for (const m of methods) {
      assert.ok(["GET", "HEAD", "OPTIONS"].includes(m), `méthode sûre attendue, reçu ${m}`);
    }
  });

  it("signale une redirection HTTP en clair et un banner disclosure", async () => {
    const { fetchImpl } = makeFetch(() =>
      mockResponse({
        status: 301,
        headers: { location: "http://insecure.example/login", server: "nginx/1.18.0" },
      }),
    );

    const res = await runDastScan({ target: "http://localhost:8080", fetchImpl });

    assert.ok(res.findings.some((f) => f.ruleId === "DAST-INSECURE-REDIRECT"));
    assert.ok(res.findings.some((f) => f.ruleId === "DAST-BANNER-DISCLOSURE"));
  });

  it("signale les cookies non sécurisés et les erreurs 5xx", async () => {
    const { fetchImpl } = makeFetch(() =>
      mockResponse({
        status: 500,
        headers: { "set-cookie": "sid=abc123; Path=/" },
      }),
    );

    const res = await runDastScan({ target: "http://localhost:3000", fetchImpl });

    assert.ok(res.findings.some((f) => f.ruleId === "DAST-INSECURE-COOKIE"));
    assert.ok(res.findings.some((f) => f.ruleId === "DAST-SERVER-ERROR"));
  });

  it("comptabilise les endpoints injoignables sans planter", async () => {
    const { fetchImpl } = makeFetch(() => null); // simule une erreur réseau

    const res = await runDastScan({
      target: "http://localhost:9999",
      endpoints: [{ path: "/x" }],
      fetchImpl,
    });

    assert.equal(res.unreachable.length, 1);
    assert.equal(res.findings.length, 0);
  });

  it("respecte le plafond de requêtes (maxRequests)", async () => {
    const { fetchImpl, calls } = makeFetch(() => mockResponse({ status: 200, headers: {} }));

    await runDastScan({
      target: "http://localhost:3000",
      endpoints: [{ path: "/1" }, { path: "/2" }, { path: "/3" }, { path: "/4" }],
      maxRequests: 2,
      fetchImpl,
    });

    assert.equal(calls.length, 2, "le plafond maxRequests doit borner les requêtes");
  });

  it("corrobore dynamiquement un finding SAST exposé via une route (sans exploitation)", async () => {
    // La route /users existe et répond 200 → corroboration.
    const { fetchImpl, calls } = makeFetch((url) =>
      url.includes("/users")
        ? mockResponse({ status: 200, headers: {} })
        : mockResponse({ status: 200, headers: {} }),
    );

    const sast = makeSastFinding({
      id: "sast-ssrf-1",
      ruleId: "SAST-SSRF",
      location: { filePath: "server/routes/users.ts", startLine: 10 },
    });

    const res = await runDastScan({
      target: "http://localhost:3000",
      sastFindings: [sast],
      fetchImpl,
    });

    assert.deepEqual(res.corroboratedSastIds, ["sast-ssrf-1"]);
    const corr = res.findings.find((f) => f.ruleId === "DAST-SAST-CORROBORATION");
    assert.ok(corr, "un finding de corroboration doit être produit");
    assert.equal(corr!.metadata?.corroboratesFindingId, "sast-ssrf-1");
    // La corroboration ne doit émettre qu'une requête GET inoffensive.
    assert.ok(calls.some((c) => c.method === "GET" && c.url.includes("/users")));
    assert.ok(calls.every((c) => c.method === "GET"));
  });

  it("ne corrobore PAS quand la route SAST est injoignable", async () => {
    // Racine OK, mais la route /users échoue (réseau).
    const { fetchImpl } = makeFetch((url) =>
      url.endsWith("/users") ? null : mockResponse({ status: 200, headers: {} }),
    );

    const sast = makeSastFinding({
      id: "sast-ssrf-2",
      ruleId: "SAST-SSRF",
      location: { filePath: "server/routes/users.ts", startLine: 10 },
    });

    const res = await runDastScan({
      target: "http://localhost:3000",
      sastFindings: [sast],
      fetchImpl,
    });

    assert.equal(res.corroboratedSastIds.length, 0);
    assert.ok(!res.findings.some((f) => f.ruleId === "DAST-SAST-CORROBORATION"));
  });

  it("sort proprement sans cible", async () => {
    const { fetchImpl, calls } = makeFetch(() => mockResponse({ status: 200, headers: {} }));
    const res = await runDastScan({ target: "", fetchImpl });
    assert.equal(res.requestsSent, 0);
    assert.equal(calls.length, 0);
  });
});
