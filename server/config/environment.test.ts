import test from "node:test";
import assert from "node:assert/strict";
import { validateEnvironment } from "./environment.js";

test("validateEnvironment accepts optional and valid configuration", () => {
  assert.doesNotThrow(() => validateEnvironment({
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    REDIS_URL: "redis://localhost:6379",
    LEANNA_KNOWLEDGE_CACHE_TTL_SECONDS: "86400",
    SANDBOX_EXIT_CODE: "123456",
    ENABLE_CHAIN_OF_THOUGHT: "true",
    LOG_LEVEL: "info",
    NODE_ENV: "development",
  }));
});

test("validateEnvironment reports invalid values together", () => {
  assert.throws(
    () => validateEnvironment({
      SUPABASE_URL: "not-a-url",
      ENABLE_CHAIN_OF_THOUGHT: "yes",
      LEANNA_KNOWLEDGE_CACHE_TTL_SECONDS: "0",
      SANDBOX_EXIT_CODE: "123",
      LOG_LEVEL: "verbose",
    }),
    (error: unknown) => {
      assert.match(String(error), /SUPABASE_URL/);
      assert.match(String(error), /ENABLE_CHAIN_OF_THOUGHT/);
      assert.match(String(error), /LEANNA_KNOWLEDGE_CACHE_TTL_SECONDS/);
      assert.match(String(error), /SANDBOX_EXIT_CODE/);
      assert.match(String(error), /LOG_LEVEL/);
      return true;
    },
  );
});

test("validateEnvironment requires the Supabase variables as a pair", () => {
  assert.throws(
    () => validateEnvironment({ SUPABASE_SERVICE_ROLE_KEY: "service-role-key" }),
    /SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY doivent être définies ensemble/,
  );
});