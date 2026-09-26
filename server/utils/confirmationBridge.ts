/**
 * confirmationBridge.ts — Mécanisme de confirmation interactive pour les fichiers critiques.
 *
 * Quand l'IA tente de modifier un fichier marqué critique, le skill émet une
 * demande de confirmation vers l'UI via WebSocket. L'utilisateur accepte ou refuse.
 * Si pas de réponse dans le timeout → refus automatique.
 */

export interface ConfirmationRequest {
  requestId: string;
  filePath: string;
  operation: 'write' | 'modify' | 'patch' | 'delete' | 'rename' | 'npm-command';
  reason?: string;
  riskLevel?: "standard" | "high";
  /** Timestamp de la demande */
  createdAt: number;
}

interface PendingConfirmation {
  resolve: (approved: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
  request: ConfirmationRequest;
}

const CONFIRMATION_TIMEOUT_MS = 30_000; // 30 secondes

/** Confirmations en attente (requestId → pending) */
const pending = new Map<string, PendingConfirmation>();

let idCounter = 0;

/**
 * Génère un ID unique pour chaque demande de confirmation.
 */
function generateRequestId(): string {
  return `confirm-${Date.now()}-${++idCounter}`;
}

/**
 * Demande une confirmation à l'utilisateur via WebSocket.
 *
 * @param filePath - Chemin relatif du fichier critique
 * @param operation - Type d'opération (write, modify, delete, etc.)
 * @param emitFn - Fonction pour émettre vers le client WebSocket
 * @param reason - Raison optionnelle de la modification
 * @returns Promise<boolean> — true si approuvé, false si refusé ou timeout
 */
export function requestConfirmation(
  filePath: string,
  operation: ConfirmationRequest['operation'],
  emitFn: (data: any) => void,
  reason?: string,
  riskLevel: ConfirmationRequest["riskLevel"] = "standard",
): Promise<boolean> {
  const requestId = generateRequestId();
  const request: ConfirmationRequest = {
    requestId,
    filePath,
    operation,
    reason,
    riskLevel,
    createdAt: Date.now(),
  };

  return new Promise<boolean>((resolve) => {
    // Timer pour timeout automatique
    const timer = setTimeout(() => {
      console.log(`[Confirmation] Timeout pour ${filePath} (${requestId}) — refus automatique`);
      pending.delete(requestId);
      resolve(false);
    }, CONFIRMATION_TIMEOUT_MS);

    pending.set(requestId, { resolve, timer, request });

    // Émettre la demande vers le client
    try {
      emitFn({
        type: 'confirm-critical-edit',
        requestId,
        filePath,
        operation,
        reason,
        riskLevel,
        timeoutMs: CONFIRMATION_TIMEOUT_MS,
      });
      console.log(`[Confirmation] Demande envoyée: ${operation} sur ${filePath} (${requestId})`);
    } catch (e) {
      console.error(`[Confirmation] Échec d'envoi vers le client:`, e);
      clearTimeout(timer);
      pending.delete(requestId);
      resolve(false);
    }
  });
}

/**
 * Reçoit la réponse du client (appelé quand le WebSocket reçoit un message
 * de type 'confirm-response').
 *
 * @returns true si la confirmation a été traitée, false si requestId inconnu
 */
export function handleConfirmationResponse(requestId: string, approved: boolean): boolean {
  const entry = pending.get(requestId);
  if (!entry) {
    console.warn(`[Confirmation] Réponse pour requestId inconnu: ${requestId}`);
    return false;
  }

  clearTimeout(entry.timer);
  pending.delete(requestId);
  entry.resolve(approved);

  console.log(`[Confirmation] ${approved ? '✓ Approuvé' : '✗ Refusé'}: ${entry.request.operation} sur ${entry.request.filePath}`);
  return true;
}

/**
 * Retourne le nombre de confirmations en attente (utile pour debug/monitoring).
 */
export function getPendingCount(): number {
  return pending.size;
}

/**
 * Annule toutes les confirmations en attente (cleanup).
 */
export function cancelAllPending(): void {
  for (const [id, entry] of pending) {
    clearTimeout(entry.timer);
    entry.resolve(false);
  }
  pending.clear();
}
