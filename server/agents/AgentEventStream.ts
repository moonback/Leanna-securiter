import type { AgentEvent } from "./ProgressNotifier.js";

export type AgentEventListener = (event: AgentEvent) => void;

class AgentEventStream {
  private listeners = new Set<AgentEventListener>();

  subscribe(listener: AgentEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(event: AgentEvent): void {
    for (const listener of this.listeners) {
      try { listener(event); } catch { /* An SSE client must not block agent execution. */ }
    }
  }
}

export const agentEventStream = new AgentEventStream();
