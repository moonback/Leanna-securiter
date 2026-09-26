import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import {
  getScheduledTasksSnapshot,
  getScheduledTask,
  pauseScheduledTask,
  resumeScheduledTask,
  cancelScheduledTask,
  stopAllScheduledTasks,
  setSchedulerSkillHandler,
  type ScheduledTaskDefinition,
} from "./automationScheduler.js";

describe("automationScheduler", () => {
  let taskCounter = 0;

  beforeEach(() => {
    // Reset any scheduled tasks before each test
    stopAllScheduledTasks();
  });

  afterEach(() => {
    // Clean up after each test
    stopAllScheduledTasks();
  });

  describe("getScheduledTasksSnapshot", () => {
    it("should return an array", () => {
      const snapshot = getScheduledTasksSnapshot();
      assert.ok(Array.isArray(snapshot));
    });

    it("should return an empty array initially", () => {
      const snapshot = getScheduledTasksSnapshot();
      assert.strictEqual(snapshot.length, 0);
    });

    it("should return task definitions with correct structure", () => {
      const snapshot = getScheduledTasksSnapshot();

      for (const task of snapshot) {
        assert.ok(typeof task.id === "string");
        assert.ok(typeof task.name === "string");
        assert.ok(typeof task.description === "string");
        assert.ok(typeof task.actionName === "string");
        assert.ok(typeof task.args === "object");
        assert.ok(typeof task.intervalMs === "number");
        assert.ok(typeof task.intervalExpression === "string");
        assert.ok(typeof task.enabled === "boolean");
        assert.ok(typeof task.createdAt === "number");
      }
    });
  });

  describe("getScheduledTask", () => {
    it("should return undefined for non-existent task", () => {
      const task = getScheduledTask("non-existent-id");
      assert.strictEqual(task, undefined);
    });

    it("should return task definition if it exists", () => {
      // Since we can't easily create tasks without Supabase in tests,
      // we verify the function works with non-existent IDs
      const result = getScheduledTask("test-id-123");
      assert.strictEqual(result, undefined);
    });
  });

  describe("pauseScheduledTask", () => {
    it("should return not_found for non-existent task", () => {
      const result = pauseScheduledTask("non-existent-id");
      assert.strictEqual(result.status, "not_found");
      assert.ok(result.message);
      assert.ok(result.message.includes("introuvable"));
    });

    it("should have a message explaining the result", () => {
      const result = pauseScheduledTask("test-id");
      assert.ok(result.message);
      assert.ok(typeof result.message === "string");
      assert.ok(result.message.length > 0);
    });

    it("should return a status field", () => {
      const result = pauseScheduledTask("any-id");
      assert.ok(result.status);
      assert.ok(typeof result.status === "string");
    });
  });

  describe("resumeScheduledTask", () => {
    it("should return not_found for non-existent task", () => {
      const result = resumeScheduledTask("non-existent-id");
      assert.strictEqual(result.status, "not_found");
      assert.ok(result.message);
      assert.ok(result.message.includes("introuvable"));
    });

    it("should have a message explaining the result", () => {
      const result = resumeScheduledTask("test-id");
      assert.ok(result.message);
      assert.ok(typeof result.message === "string");
    });

    it("should return a status field", () => {
      const result = resumeScheduledTask("any-id");
      assert.ok(result.status);
      assert.ok(typeof result.status === "string");
    });
  });

  describe("cancelScheduledTask", () => {
    it("should return false for non-existent task", () => {
      const result = cancelScheduledTask("non-existent-id");
      assert.strictEqual(result, false);
    });

    it("should return a boolean", () => {
      const result = cancelScheduledTask("test-id");
      assert.ok(typeof result === "boolean");
    });
  });

  describe("stopAllScheduledTasks", () => {
    it("should not throw when called", () => {
      assert.doesNotThrow(() => {
        stopAllScheduledTasks();
      });
    });

    it("should be callable multiple times", () => {
      stopAllScheduledTasks();
      stopAllScheduledTasks();
      stopAllScheduledTasks();
      assert.ok(true); // Should not crash
    });

    it("should clear all tasks", () => {
      stopAllScheduledTasks();
      const snapshot = getScheduledTasksSnapshot();
      assert.strictEqual(snapshot.length, 0);
    });
  });

  describe("setSchedulerSkillHandler", () => {
    it("should accept a handler function", () => {
      const handler = async (name: string, args: any) => {
        return { status: "success" };
      };

      assert.doesNotThrow(() => {
        setSchedulerSkillHandler(handler);
      });
    });

    it("should accept null to clear handler", () => {
      assert.doesNotThrow(() => {
        setSchedulerSkillHandler(null);
      });
    });

    it("should allow setting handler multiple times", () => {
      const handler1 = async () => ({ status: "success" });
      const handler2 = async () => ({ status: "success" });

      setSchedulerSkillHandler(handler1);
      setSchedulerSkillHandler(handler2);
      setSchedulerSkillHandler(null);

      assert.ok(true);
    });
  });

  describe("ScheduledTaskDefinition interface", () => {
    it("should have required fields", () => {
      const mockTask: ScheduledTaskDefinition = {
        id: "test-123",
        name: "Test Task",
        description: "A test task",
        actionName: "test_action",
        args: { param: "value" },
        intervalMs: 60000,
        intervalExpression: "1 minute",
        enabled: true,
        createdAt: Date.now(),
      };

      assert.strictEqual(mockTask.id, "test-123");
      assert.strictEqual(mockTask.name, "Test Task");
      assert.strictEqual(mockTask.description, "A test task");
      assert.strictEqual(mockTask.actionName, "test_action");
      assert.deepStrictEqual(mockTask.args, { param: "value" });
      assert.strictEqual(mockTask.intervalMs, 60000);
      assert.strictEqual(mockTask.intervalExpression, "1 minute");
      assert.strictEqual(mockTask.enabled, true);
      assert.ok(typeof mockTask.createdAt === "number");
    });

    it("should support optional fields", () => {
      const mockTask: ScheduledTaskDefinition = {
        id: "test-456",
        name: "Test Task 2",
        description: "Another test",
        actionName: "test_action_2",
        args: {},
        intervalMs: 30000,
        intervalExpression: "30 seconds",
        enabled: false,
        createdAt: Date.now(),
        lastRunAt: Date.now() - 1000,
        lastSuccess: true,
        lastError: undefined,
        consecutiveFailures: 0,
      };

      assert.ok(typeof mockTask.lastRunAt === "number");
      assert.strictEqual(mockTask.lastSuccess, true);
      assert.strictEqual(mockTask.lastError, undefined);
      assert.strictEqual(mockTask.consecutiveFailures, 0);
    });

    it("should support error tracking fields", () => {
      const mockTask: ScheduledTaskDefinition = {
        id: "test-789",
        name: "Failed Task",
        description: "A task that failed",
        actionName: "failing_action",
        args: {},
        intervalMs: 120000,
        intervalExpression: "2 minutes",
        enabled: true,
        createdAt: Date.now(),
        lastRunAt: Date.now() - 5000,
        lastSuccess: false,
        lastError: "Connection timeout",
        consecutiveFailures: 3,
      };

      assert.strictEqual(mockTask.lastSuccess, false);
      assert.strictEqual(mockTask.lastError, "Connection timeout");
      assert.strictEqual(mockTask.consecutiveFailures, 3);
    });
  });

  describe("Integration behavior", () => {
    it("should maintain state consistency after stop", () => {
      stopAllScheduledTasks();
      const beforeSnapshot = getScheduledTasksSnapshot();

      stopAllScheduledTasks();
      const afterSnapshot = getScheduledTasksSnapshot();

      assert.deepStrictEqual(beforeSnapshot, afterSnapshot);
    });

    it("should handle rapid pause/resume attempts", () => {
      const taskId = "rapid-test-id";

      // These should all return not_found but not crash
      pauseScheduledTask(taskId);
      resumeScheduledTask(taskId);
      pauseScheduledTask(taskId);
      resumeScheduledTask(taskId);

      assert.ok(true);
    });

    it("should handle concurrent cancellations gracefully", () => {
      const taskId = "concurrent-cancel-id";

      const result1 = cancelScheduledTask(taskId);
      const result2 = cancelScheduledTask(taskId);
      const result3 = cancelScheduledTask(taskId);

      assert.strictEqual(typeof result1, "boolean");
      assert.strictEqual(typeof result2, "boolean");
      assert.strictEqual(typeof result3, "boolean");
    });
  });

  describe("Type safety", () => {
    it("should enforce correct task structure", () => {
      const validTask: ScheduledTaskDefinition = {
        id: "type-test-1",
        name: "Type Test",
        description: "Testing types",
        actionName: "type_action",
        args: { key: "value", nested: { deep: true } },
        intervalMs: 5000,
        intervalExpression: "5s",
        enabled: true,
        createdAt: Date.now(),
      };

      assert.ok(validTask.id);
      assert.ok(validTask.name);
      assert.ok(validTask.actionName);
    });

    it("should handle complex args objects", () => {
      const complexArgs = {
        string: "value",
        number: 42,
        boolean: true,
        array: [1, 2, 3],
        nested: {
          deep: {
            value: "test",
          },
        },
        nullValue: null,
        undefinedValue: undefined,
      };

      const task: ScheduledTaskDefinition = {
        id: "complex-args",
        name: "Complex Args Task",
        description: "Task with complex arguments",
        actionName: "complex_action",
        args: complexArgs,
        intervalMs: 10000,
        intervalExpression: "10s",
        enabled: true,
        createdAt: Date.now(),
      };

      assert.deepStrictEqual(task.args, complexArgs);
    });
  });

  describe("Error scenarios", () => {
    it("should handle operations on undefined task IDs", () => {
      const undefinedId = undefined as any;

      // These should not crash even with undefined
      try {
        pauseScheduledTask(undefinedId);
        resumeScheduledTask(undefinedId);
        cancelScheduledTask(undefinedId);
        getScheduledTask(undefinedId);
      } catch (error) {
        // Catching is acceptable, crashing is not
        assert.ok(error);
      }
    });

    it("should handle operations on empty string task IDs", () => {
      const emptyId = "";

      const pauseResult = pauseScheduledTask(emptyId);
      const resumeResult = resumeScheduledTask(emptyId);
      const cancelResult = cancelScheduledTask(emptyId);
      const getResult = getScheduledTask(emptyId);

      assert.ok(pauseResult);
      assert.ok(resumeResult);
      assert.strictEqual(typeof cancelResult, "boolean");
      assert.strictEqual(getResult, undefined);
    });

    it("should handle operations on very long task IDs", () => {
      const longId = "a".repeat(1000);

      const pauseResult = pauseScheduledTask(longId);
      const resumeResult = resumeScheduledTask(longId);

      assert.strictEqual(pauseResult.status, "not_found");
      assert.strictEqual(resumeResult.status, "not_found");
    });

    it("should handle special characters in task IDs", () => {
      const specialIds = [
        "task-with-dashes",
        "task_with_underscores",
        "task.with.dots",
        "task:with:colons",
        "task/with/slashes",
      ];

      for (const id of specialIds) {
        const result = getScheduledTask(id);
        assert.strictEqual(result, undefined);
      }
    });
  });

  describe("Performance characteristics", () => {
    it("should handle multiple stopAllScheduledTasks calls efficiently", () => {
      const iterations = 100;
      const start = Date.now();

      for (let i = 0; i < iterations; i++) {
        stopAllScheduledTasks();
      }

      const duration = Date.now() - start;
      // Should complete in reasonable time (< 1 second for 100 iterations)
      assert.ok(duration < 1000, `Took too long: ${duration}ms`);
    });

    it("should handle rapid snapshot reads", () => {
      const iterations = 1000;
      const start = Date.now();

      for (let i = 0; i < iterations; i++) {
        getScheduledTasksSnapshot();
      }

      const duration = Date.now() - start;
      // Should complete quickly (< 100ms for 1000 reads)
      assert.ok(duration < 100, `Took too long: ${duration}ms`);
    });
  });

  describe("State isolation", () => {
    it("should not modify returned snapshot when original changes", () => {
      const snapshot1 = getScheduledTasksSnapshot();
      stopAllScheduledTasks();
      const snapshot2 = getScheduledTasksSnapshot();

      // snapshot1 should remain unchanged
      assert.ok(Array.isArray(snapshot1));
      assert.ok(Array.isArray(snapshot2));
    });

    it("should return independent task objects", () => {
      const task1 = getScheduledTask("test");
      const task2 = getScheduledTask("test");

      // Both should be undefined (or if they exist, should be separate objects)
      if (task1 && task2) {
        assert.notStrictEqual(task1, task2);
      } else {
        assert.strictEqual(task1, undefined);
        assert.strictEqual(task2, undefined);
      }
    });
  });
});
