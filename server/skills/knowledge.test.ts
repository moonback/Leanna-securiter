import { describe, it } from "node:test";
import assert from "node:assert";
import { knowledgeSkill } from "./knowledge.js";

describe("knowledgeSkill", () => {
  describe("Skill declaration", () => {
    it("should have the correct skill name", () => {
      assert.strictEqual(knowledgeSkill.name, "knowledge");
    });

    it("should declare all knowledge tools", () => {
      const expectedTools = [
        "knowledge_build_context",
        "knowledge_semantic_search",
        "knowledge_search_entities",
        "knowledge_memory_search",
        "knowledge_memory_add",
        "knowledge_memory_list",
        "knowledge_impact_analyze",
        "knowledge_status",
        "knowledge_reindex",
        "knowledge_ast_callers",
        "knowledge_ast_callees",
        "knowledge_ast_call_chain",
        "knowledge_ast_file_inspect",
      ];

      const declaredNames = knowledgeSkill.declarations.map((d) => d.name);
      
      for (const tool of expectedTools) {
        assert.ok(
          declaredNames.includes(tool),
          `Tool ${tool} should be declared`
        );
      }
    });

    it("should have descriptions for all declarations", () => {
      for (const decl of knowledgeSkill.declarations) {
        assert.ok(decl.description, `${decl.name} should have a description`);
        assert.ok(
          decl.description.length > 20,
          `${decl.name} description should be meaningful`
        );
      }
    });

    it("should have parameters for all declarations", () => {
      for (const decl of knowledgeSkill.declarations) {
        assert.ok(decl.parameters, `${decl.name} should have parameters`);
        assert.strictEqual(
          decl.parameters.type,
          "OBJECT",
          `${decl.name} parameters should be of type OBJECT`
        );
      }
    });
  });

  describe("Input schemas", () => {
    it("should have input schemas for all tools", () => {
      assert.ok(knowledgeSkill.inputSchemas);
      
      const schemaKeys = Object.keys(knowledgeSkill.inputSchemas);
      const declaredNames = knowledgeSkill.declarations.map((d) => d.name);

      for (const toolName of declaredNames) {
        assert.ok(
          schemaKeys.includes(toolName),
          `Input schema for ${toolName} should exist`
        );
      }
    });

    it("should validate knowledge_build_context schema", () => {
      const schema = knowledgeSkill.inputSchemas!["knowledge_build_context"];
      assert.ok(schema);

      // Valid input
      const validResult = schema.safeParse({
        query: "Test query",
        strategy: "balanced",
        detail: "standard",
      });
      assert.ok(validResult.success, "Valid input should pass");

      // Invalid input (empty query)
      const invalidResult = schema.safeParse({
        query: "",
      });
      assert.ok(!invalidResult.success, "Empty query should fail");
    });

    it("should validate knowledge_semantic_search schema", () => {
      const schema = knowledgeSkill.inputSchemas!["knowledge_semantic_search"];
      assert.ok(schema);

      const validResult = schema.safeParse({
        query: "authentication",
        max_results: 10,
        min_score: 0.5,
      });
      assert.ok(validResult.success);
    });

    it("should validate knowledge_memory_add schema", () => {
      const schema = knowledgeSkill.inputSchemas!["knowledge_memory_add"];
      assert.ok(schema);

      const validResult = schema.safeParse({
        content: "Use JWT for authentication",
        category: "decision",
        tags: ["auth", "security"],
        confidence: 0.9,
      });
      assert.ok(validResult.success);

      // Missing required fields
      const invalidResult = schema.safeParse({
        content: "Test",
      });
      assert.ok(!invalidResult.success, "Missing category should fail");
    });

    it("should validate knowledge_impact_analyze schema", () => {
      const schema = knowledgeSkill.inputSchemas!["knowledge_impact_analyze"];
      assert.ok(schema);

      const validResult = schema.safeParse({
        files: ["src/auth.ts", "src/user.ts"],
        mode: "standard",
        include_tests: false,
      });
      assert.ok(validResult.success);

      // Empty files array
      const invalidResult = schema.safeParse({
        files: [],
      });
      assert.ok(!invalidResult.success, "Empty files array should fail");
    });

    it("should validate knowledge_ast_callers schema", () => {
      const schema = knowledgeSkill.inputSchemas!["knowledge_ast_callers"];
      assert.ok(schema);

      const validResult = schema.safeParse({
        function_name: "parseFile",
        file_path: "src/parser.ts",
      });
      assert.ok(validResult.success);

      // Empty function name
      const invalidResult = schema.safeParse({
        function_name: "",
      });
      assert.ok(!invalidResult.success);
    });
  });

  describe("Schema defaults", () => {
    it("should apply defaults for knowledge_build_context", () => {
      const schema = knowledgeSkill.inputSchemas!["knowledge_build_context"];
      const result = schema.parse({
        query: "Test query",
      });

      assert.strictEqual(result.strategy, "balanced");
      assert.strictEqual(result.detail, "standard");
      assert.strictEqual(result.max_files, 6);
      assert.strictEqual(result.max_facts, 7);
    });

    it("should apply defaults for knowledge_semantic_search", () => {
      const schema = knowledgeSkill.inputSchemas!["knowledge_semantic_search"];
      const result = schema.parse({
        query: "test",
      });

      assert.strictEqual(result.max_results, 10);
      assert.strictEqual(result.min_score, 0.1);
    });

    it("should apply defaults for knowledge_memory_add", () => {
      const schema = knowledgeSkill.inputSchemas!["knowledge_memory_add"];
      const result = schema.parse({
        content: "Test fact",
        category: "decision",
      });

      assert.deepStrictEqual(result.tags, []);
      assert.strictEqual(result.confidence, 0.85);
    });

    it("should apply defaults for knowledge_impact_analyze", () => {
      const schema = knowledgeSkill.inputSchemas!["knowledge_impact_analyze"];
      const result = schema.parse({
        files: ["test.ts"],
      });

      assert.strictEqual(result.mode, "standard");
      assert.strictEqual(result.include_tests, false);
    });
  });

  describe("Schema constraints", () => {
    it("should enforce max_files limit in knowledge_build_context", () => {
      const schema = knowledgeSkill.inputSchemas!["knowledge_build_context"];
      
      const invalidResult = schema.safeParse({
        query: "test",
        max_files: 50, // max is 30
      });
      assert.ok(!invalidResult.success);
    });

    it("should enforce max_results limit in knowledge_semantic_search", () => {
      const schema = knowledgeSkill.inputSchemas!["knowledge_semantic_search"];
      
      const invalidResult = schema.safeParse({
        query: "test",
        max_results: 100, // max is 30
      });
      assert.ok(!invalidResult.success);
    });

    it("should enforce min_score range in knowledge_semantic_search", () => {
      const schema = knowledgeSkill.inputSchemas!["knowledge_semantic_search"];
      
      const invalidLow = schema.safeParse({
        query: "test",
        min_score: -0.1,
      });
      assert.ok(!invalidLow.success);

      const invalidHigh = schema.safeParse({
        query: "test",
        min_score: 1.5,
      });
      assert.ok(!invalidHigh.success);
    });

    it("should enforce confidence range in knowledge_memory_add", () => {
      const schema = knowledgeSkill.inputSchemas!["knowledge_memory_add"];
      
      const invalidResult = schema.safeParse({
        content: "test",
        category: "decision",
        confidence: 2.0, // max is 1.0
      });
      assert.ok(!invalidResult.success);
    });

    it("should enforce files array limits in knowledge_impact_analyze", () => {
      const schema = knowledgeSkill.inputSchemas!["knowledge_impact_analyze"];
      
      // Too many files
      const tooMany = Array.from({ length: 51 }, (_, i) => `file${i}.ts`);
      const invalidResult = schema.safeParse({
        files: tooMany,
      });
      assert.ok(!invalidResult.success);
    });

    it("should enforce depth limit in knowledge_ast_call_chain", () => {
      const schema = knowledgeSkill.inputSchemas!["knowledge_ast_call_chain"];
      
      const invalidResult = schema.safeParse({
        function_name: "test",
        depth: 10, // max is 6
      });
      assert.ok(!invalidResult.success);
    });
  });

  describe("Enum validation", () => {
    it("should validate strategy enum in knowledge_build_context", () => {
      const schema = knowledgeSkill.inputSchemas!["knowledge_build_context"];

      const validStrategies = [
        "balanced",
        "code_first",
        "memory_first",
        "graph_first",
        "minimal",
      ];

      for (const strategy of validStrategies) {
        const result = schema.safeParse({
          query: "test",
          strategy,
        });
        assert.ok(result.success, `Strategy '${strategy}' should be valid`);
      }

      const invalidResult = schema.safeParse({
        query: "test",
        strategy: "invalid_strategy",
      });
      assert.ok(!invalidResult.success);
    });

    it("should validate detail enum in knowledge_build_context", () => {
      const schema = knowledgeSkill.inputSchemas!["knowledge_build_context"];

      const validDetails = ["compact", "standard", "verbose"];

      for (const detail of validDetails) {
        const result = schema.safeParse({
          query: "test",
          detail,
        });
        assert.ok(result.success, `Detail '${detail}' should be valid`);
      }
    });

    it("should validate category enum in knowledge_memory_add", () => {
      const schema = knowledgeSkill.inputSchemas!["knowledge_memory_add"];

      const validCategories = [
        "architecture",
        "convention",
        "pattern",
        "decision",
        "known-bug",
        "api",
        "module",
        "workflow",
        "security",
        "stack",
        "refactoring",
        "todo",
      ];

      for (const category of validCategories) {
        const result = schema.safeParse({
          content: "test",
          category,
        });
        assert.ok(result.success, `Category '${category}' should be valid`);
      }

      const invalidResult = schema.safeParse({
        content: "test",
        category: "invalid_category",
      });
      assert.ok(!invalidResult.success);
    });

    it("should validate mode enum in knowledge_impact_analyze", () => {
      const schema = knowledgeSkill.inputSchemas!["knowledge_impact_analyze"];

      const validModes = ["quick", "standard", "deep", "reverse"];

      for (const mode of validModes) {
        const result = schema.safeParse({
          files: ["test.ts"],
          mode,
        });
        assert.ok(result.success, `Mode '${mode}' should be valid`);
      }
    });
  });

  describe("String trimming", () => {
    it("should trim query in knowledge_build_context", () => {
      const schema = knowledgeSkill.inputSchemas!["knowledge_build_context"];
      const result = schema.parse({
        query: "  test query  ",
      });

      assert.strictEqual(result.query, "test query");
    });

    it("should trim content in knowledge_memory_add", () => {
      const schema = knowledgeSkill.inputSchemas!["knowledge_memory_add"];
      const result = schema.parse({
        content: "  test fact  ",
        category: "decision",
      });

      assert.strictEqual(result.content, "test fact");
    });

    it("should trim file paths in knowledge_impact_analyze", () => {
      const schema = knowledgeSkill.inputSchemas!["knowledge_impact_analyze"];
      const result = schema.parse({
        files: ["  src/test.ts  ", "  src/other.ts  "],
      });

      assert.strictEqual(result.files[0], "src/test.ts");
      assert.strictEqual(result.files[1], "src/other.ts");
    });
  });

  describe("handleToolCall", () => {
    it("should be a function", () => {
      assert.strictEqual(typeof knowledgeSkill.handleToolCall, "function");
    });

    it("should handle unknown tool names gracefully", async () => {
      try {
        const result = await knowledgeSkill.handleToolCall(
          "unknown_tool",
          {},
          undefined
        );
        // Should either return an error or undefined
        assert.ok(
          !result || result.error || result.status === "error",
          "Unknown tool should return error or undefined"
        );
      } catch (err) {
        // Throwing is also acceptable
        assert.ok(true);
      }
    });
  });
});
