/**
 * ModuleLoader — Chargeur de modules universel (ESM/CommonJS)
 *
 * Solution professionnelle pour gérer la compatibilité entre :
 * - ESM (import/export) → Node.js moderne
 * - CommonJS (require/module.exports) → Héritage
 *
 * Utilisation :
 *   import { importModule, requireCompat } from './ModuleLoader.js';
 *   const fs = await importModule('fs');
 *   const path = requireCompat('path'); // Déconseillé en ESM
 */

import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

// Détecte si on est en mode ESM (Node.js 12+)
const isESM = (() => {
  try {
    // En ESM pur, `require` n'existe pas dans la portée globale
    // Ou `import.meta.url` est disponible
    return typeof require === 'undefined' || !!import.meta?.url;
  } catch {
    return false;
  }
})();

// Crée un `require` compatible ESM pour les modules CommonJS
// Utilise `createRequire` de Node.js pour émuler `require` en ESM
const esmRequire = (() => {
  if (isESM && import.meta?.url) {
    return createRequire(import.meta.url);
  } else {
    // En CommonJS, on utilise le `require` global
    return require;
  }
})();

/**
 * Charge un module de manière asynchrone (recommandé pour ESM)
 * @param modulePath Chemin du module (ex: 'fs', './config.json')
 * @param options Options de chargement
 * @returns Promise du module importé
 *
 * @example
 * // Charger un module npm
 * const fs = await importModule<'typeof import("fs")'>('fs');
 *
 * @example
 * // Charger un fichier JSON
 * const config = await importModule('./config.json', { assertType: 'json' });
 *
 * @example
 * // Charger depuis un répertoire spécifique
 * const skill = await importModule('../skills/git', { cwd: __dirname });
 */
export const importModule = async <T = unknown>(
  modulePath: string,
  options: { cwd?: string; assertType?: string } = {}
): Promise<T> => {
  const { cwd, assertType } = options;
  
  try {
    if (isESM) {
      // Mode ESM : Import dynamique
      const fullPath = cwd 
        ? pathToFileURL(resolve(cwd, modulePath)).href
        : modulePath;
      
      if (assertType) {
        // Pour les imports avec assertions (JSON, etc.)
        const result = await import(fullPath, { 
          assert: { type: assertType } 
        });
        return (result.default ?? result) as T;
      } else {
        // Import dynamique standard
        const result = await import(fullPath);
        return (result.default ?? result) as T;
      }
    } else {
      // Mode CommonJS : require classique
      const resolvedPath = cwd ? resolve(cwd, modulePath) : modulePath;
      return esmRequire(resolvedPath) as T;
    }
  } catch (error) {
    const errorMessage = (error as Error)?.message || String(error);
    throw new Error(
      `Échec du chargement du module "${modulePath}" (ESM: ${isESM}): ${errorMessage}`
    );
  }
};

/**
 * Charge un module de manière synchrone (CommonJS uniquement)
 * @deprecated Préférez `importModule` en mode ESM
 * @param modulePath Chemin du module
 * @returns Module chargé
 */
export const requireCompat = <T = unknown>(modulePath: string): T => {
  if (!isESM) {
    return esmRequire(modulePath) as T;
  }
  throw new Error(
    '`requireCompat` est désactivé en mode ESM. Utilisez `importModule` à la place.'
  );
};

/**
 * Version synchrone optimisée pour les modules natifs Node.js
 * (fs, path, crypto, etc.) — fonctionne en ESM et CommonJS
 * @param moduleName Nom du module natif (ex: 'fs', 'path', 'crypto')
 * @returns Module natif
 */
export const requireNative = <T = unknown>(moduleName: string): T => {
  // Les modules natifs sont toujours disponibles via requireCompat
  // Même en ESM, Node.js les gère correctement
  try {
    return esmRequire(moduleName) as T;
  } catch (error) {
    throw new Error(
      `Échec du chargement du module natif "${moduleName}": ${(error as Error).message}`
    );
  }
};

/**
 * Utilitaire pour vérifier si on est en mode ESM
 */
export const isESModule = (): boolean => isESM;

/**
 * Répertoire du fichier courant (équivalent __dirname en ESM)
 */
export const currentDir = isESM 
  ? dirname(fileURLToPath(import.meta.url))
  : __dirname;

export default {
  importModule,
  requireCompat,
  requireNative,
  isESModule,
  currentDir,
};
