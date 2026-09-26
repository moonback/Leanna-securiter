/**
 * Registre partagé des lectures de page browser en attente.
 * Utilisé par :
 *   - server/skills/browser.ts  → insère la promesse (browser_read_content)
 *   - server.ts                 → résout la promesse (POST /api/browser/content-result)
 */

export interface PendingRead {
  resolve: (text: string) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export const browserReadPending = new Map<string, PendingRead>();
