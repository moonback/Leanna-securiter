import { useEffect } from 'react';

const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 10000;

function dispatchAgentEvent(payload: string): void {
  try {
    const event = JSON.parse(payload);
    if (event?.type === 'agent_event') {
      window.dispatchEvent(new CustomEvent('Leanna-agent-event', { detail: event }));
    }
  } catch {
    // Ignore incomplete or malformed server events.
  }
}

export function useAgentEventStream(): void {
  useEffect(() => {
    let stopped = false;
    let retryDelay = RETRY_MIN_MS;
    let controller: AbortController | null = null;

    const wait = (delay: number) => new Promise<void>((resolve) => setTimeout(resolve, delay));

    const connect = async (): Promise<void> => {
      while (!stopped) {
        controller = new AbortController();
        try {
          const token = localStorage.getItem('Leanna_api_token');
          const response = await fetch('/api/agents/events', {
            headers: token ? { 'x-leanna-token': token } : {},
            signal: controller.signal,
          });
          if (!response.ok || !response.body) throw new Error(`SSE HTTP ${response.status}`);

          retryDelay = RETRY_MIN_MS;
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          while (!stopped) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const frames = buffer.split(/\r?\n\r?\n/);
            buffer = frames.pop() ?? '';
            for (const frame of frames) {
              const data = frame
                .split(/\r?\n/)
                .filter((line) => line.startsWith('data:'))
                .map((line) => line.slice(5).trimStart())
                .join('\n');
              if (data) dispatchAgentEvent(data);
            }
          }
        } catch {
          if (stopped) return;
        } finally {
          controller = null;
        }

        if (!stopped) {
          await wait(retryDelay);
          retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
        }
      }
    };

    void connect();
    return () => {
      stopped = true;
      controller?.abort();
    };
  }, []);
}
