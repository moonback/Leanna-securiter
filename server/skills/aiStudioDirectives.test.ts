import { describe, it } from "node:test";
import assert from "node:assert";
import { aiStudioDirectivesSkill } from "./aiStudioDirectives.js";

describe("aiStudioDirectives", () => {
  describe("Skill declaration", () => {
    it("should have the correct skill name", () => {
      assert.strictEqual(aiStudioDirectivesSkill.name, "aiStudioDirectives");
    });

    it("should declare all 4 tool functions", () => {
      assert.strictEqual(aiStudioDirectivesSkill.declarations.length, 4);
      
      const names = aiStudioDirectivesSkill.declarations.map(d => d.name);
      assert.ok(names.includes("get_behavior_directives"));
      assert.ok(names.includes("get_technical_directives"));
      assert.ok(names.includes("get_design_directives"));
      assert.ok(names.includes("get_all_directives"));
    });

    it("should have descriptions for each declaration", () => {
      for (const decl of aiStudioDirectivesSkill.declarations) {
        assert.ok(decl.description);
        assert.ok(decl.description.length > 20);
      }
    });
  });

  describe("get_behavior_directives", () => {
    it("should return behavior directives as a string", async () => {
      const result = await aiStudioDirectivesSkill.handleToolCall(
        "get_behavior_directives",
        {}
      );

      assert.strictEqual(result.status, "success");
      assert.ok(result.content);
      assert.strictEqual(typeof result.content, "string");
    });

    it("should include key behavior concepts", async () => {
      const result = await aiStudioDirectivesSkill.handleToolCall(
        "get_behavior_directives",
        {}
      );

      const content = result.content as string;
      assert.ok(content.includes("COMPORTEMENT"));
      assert.ok(content.includes("Question informationnelle"));
      assert.ok(content.includes("Demande de modification"));
      assert.ok(content.includes("Cas ambigu"));
    });
  });

  describe("get_technical_directives", () => {
    it("should return technical directives as a string", async () => {
      const result = await aiStudioDirectivesSkill.handleToolCall(
        "get_technical_directives",
        {}
      );

      assert.strictEqual(result.status, "success");
      assert.ok(result.content);
      assert.strictEqual(typeof result.content, "string");
    });

    it("should include TypeScript and styling guidelines", async () => {
      const result = await aiStudioDirectivesSkill.handleToolCall(
        "get_technical_directives",
        {}
      );

      const content = result.content as string;
      assert.ok(content.includes("TECHNIQUE"));
      assert.ok(content.includes("TypeScript"));
      assert.ok(content.includes("Tailwind CSS"));
      assert.ok(content.includes("enum"));
    });

    it("should include security guidelines for API keys", async () => {
      const result = await aiStudioDirectivesSkill.handleToolCall(
        "get_technical_directives",
        {}
      );

      const content = result.content as string;
      assert.ok(content.includes("clés API"));
      assert.ok(content.includes("SERVEUR"));
    });
  });

  describe("get_design_directives", () => {
    it("should return design directives as a string", async () => {
      const result = await aiStudioDirectivesSkill.handleToolCall(
        "get_design_directives",
        {}
      );

      assert.strictEqual(result.status, "success");
      assert.ok(result.content);
      assert.strictEqual(typeof result.content, "string");
    });

    it("should include accessibility and quality guidelines", async () => {
      const result = await aiStudioDirectivesSkill.handleToolCall(
        "get_design_directives",
        {}
      );

      const content = result.content as string;
      assert.ok(content.includes("CONCEPTION"));
      assert.ok(content.includes("Accessibilité"));
      assert.ok(content.includes("contraste"));
      assert.ok(content.includes("iFrame"));
    });
  });

  describe("get_all_directives", () => {
    it("should return all directives combined", async () => {
      const result = await aiStudioDirectivesSkill.handleToolCall(
        "get_all_directives",
        {}
      );

      assert.strictEqual(result.status, "success");
      assert.ok(result.content);
      assert.strictEqual(typeof result.content, "string");
    });

    it("should include content from all three categories", async () => {
      const result = await aiStudioDirectivesSkill.handleToolCall(
        "get_all_directives",
        {}
      );

      const content = result.content as string;
      assert.ok(content.includes("COMPORTEMENT"));
      assert.ok(content.includes("TECHNIQUE"));
      assert.ok(content.includes("CONCEPTION"));
      assert.ok(content.includes("TypeScript"));
      assert.ok(content.includes("Accessibilité"));
      assert.ok(content.includes("Question informationnelle"));
    });

    it("should be longer than individual directive sections", async () => {
      const allResult = await aiStudioDirectivesSkill.handleToolCall(
        "get_all_directives",
        {}
      );
      const behaviorResult = await aiStudioDirectivesSkill.handleToolCall(
        "get_behavior_directives",
        {}
      );

      const allContent = allResult.content as string;
      const behaviorContent = behaviorResult.content as string;

      assert.ok(allContent.length > behaviorContent.length);
    });
  });

  describe("Error handling", () => {
    it("should throw error for unknown tool name", async () => {
      await assert.rejects(
        async () => {
          await aiStudioDirectivesSkill.handleToolCall("unknown_tool", {});
        },
        {
          message: /Unknown tool in aiStudioDirectives/,
        }
      );
    });
  });
});
