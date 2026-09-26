/**
 * cleanup.ts — Gestion centralisée du nettoyage des ressources globales
 * 
 * Ce module garantit qu'aucun event listener ne reste actif après le reload
 * ou la fermeture de l'application, évitant ainsi les fuites mémoire.
 * 
 * À appeler dans main.tsx au unmount de l'application.
 */

import { destroyActivityStore } from '../stores/agentActivityStore.js';
import { cleanupSandboxListeners } from '../services/sandboxApi.js';
import { cleanupRealtimeCacheListeners, realtimeWs } from '../services/realtimeCache.js';

/**
 * Liste des fonctions de cleanup à exécuter.
 * Les modules peuvent s'enregistrer ici s'ils ont des ressources à nettoyer.
 */
const cleanupCallbacks: Array<() => void> = [];

/**
 * Enregistre une fonction de cleanup à exécuter lors de la fermeture.
 */
export function registerCleanup(fn: () => void): void {
  cleanupCallbacks.push(fn);
}

/**
 * Nettoie toutes les ressources globales de l'application.
 * 
 * Cette fonction doit être appelée:
 * - Dans le cleanup du useEffect principal de main.tsx
 * - Avant tout reload de l'application
 * - Lors de la fermeture de l'onglet (beforeunload)
 */
export function cleanupGlobalResources(): void {
  console.log('[Cleanup] Nettoyage des ressources globales...');
  
  try {
    // Nettoyer le store d'activité des agents
    destroyActivityStore();
  } catch (e) {
    console.error('[Cleanup] Erreur lors du nettoyage du store d\'activité:', e);
  }
  
  try {
    // Nettoyer les listeners du sandboxApi
    cleanupSandboxListeners();
  } catch (e) {
    console.error('[Cleanup] Erreur lors du nettoyage des listeners sandbox:', e);
  }
  
  try {
    // Nettoyer les listeners du realtimeCache
    cleanupRealtimeCacheListeners();
  } catch (e) {
    console.error('[Cleanup] Erreur lors du nettoyage du realtimeCache:', e);
  }
  
  try {
    // Fermer la connexion WebSocket du realtimeCache
    realtimeWs.disconnect();
  } catch (e) {
    console.error('[Cleanup] Erreur lors de la fermeture du WebSocket:', e);
  }
  
  // Exécuter les callbacks enregistrés
  for (const fn of cleanupCallbacks) {
    try {
      fn();
    } catch (e) {
      console.error('[Cleanup] Erreur lors de l\'exécution d\'un callback:', e);
    }
  }
  
  // Vider la liste des callbacks
  cleanupCallbacks.length = 0;
  
  console.log('[Cleanup] Nettoyage terminé');
}

/**
 * Installe un listener beforeunload pour nettoyer avant la fermeture de l'onglet.
 * À appeler une seule fois au démarrage de l'application.
 */
export function installBeforeUnloadCleanup(): () => void {
  const handler = () => {
    cleanupGlobalResources();
  };
  
  window.addEventListener('beforeunload', handler);
  
  return () => {
    window.removeEventListener('beforeunload', handler);
  };
}
