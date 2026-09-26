import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const handler = fs.readFileSync(path.resolve(process.cwd(), "server/live/LiveSocketHandler.ts"), "utf8");

test("security_audit is available in the default and ask tool tiers", () => {
  const tierStart = handler.indexOf("const TIER1_CORE_TOOLS");
  const askStart = handler.indexOf("const ASK_MODE_ALLOWED_TOOLS");
  assert.ok(tierStart >= 0 && askStart > tierStart);
  assert.match(handler.slice(tierStart, askStart), /'security_audit'/);
  assert.match(handler.slice(askStart, askStart + 2_000), /'security_audit'/);
});