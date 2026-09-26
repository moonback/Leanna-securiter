import type { RuntimeEvent } from "../runtime/types.js";

export interface Perception {
  event: RuntimeEvent;
  importance: number;
  novelty: number;
  requiresAttention: boolean;
  affectedResources: string[];
  possibleActions: Array<"observe" | "maintenance" | "mission">;
  reason: string;
}

/** Deterministic event classification; it deliberately never calls a model. */
export class PerceptionEngine {
  perceive(event: RuntimeEvent): Perception {
    switch (event.type) {
      case "task:failed":
        return this.result(event, .8, ["observe", "maintenance"], `Task ${event.taskId} failed.`);
      case "tool:permissionDenied":
        return this.result(event, .9, ["observe"], `Tool ${event.toolName} was denied by policy.`);
      case "workflow:completed":
        return this.result(event, event.success ? .2 : .75, event.success ? [] : ["observe", "maintenance"], `Workflow ${event.workflowId} ${event.success ? "completed" : "failed"}.`);
      case "autonomy:heartbeat":
        return this.result(event, event.attentionRequired ? .5 : .05, event.attentionRequired ? ["maintenance"] : [], event.reason);
      case "autonomy:health":
        return this.result(event, event.status === "healthy" ? .1 : .85, event.status === "healthy" ? [] : ["observe", "maintenance"], event.reason);
      default:
        return this.result(event, .15, [], "Routine runtime event.");
    }
  }

  private result(event: RuntimeEvent, importance: number, possibleActions: Perception["possibleActions"], reason: string): Perception {
    return { event, importance, novelty: 1, requiresAttention: importance >= .5, affectedResources: this.resources(event), possibleActions, reason };
  }

  private resources(event: RuntimeEvent): string[] {
    if ("taskId" in event) return [event.taskId];
    if ("workflowId" in event) return [event.workflowId];
    if ("toolName" in event) return [event.toolName];
    return [];
  }
}
