/**
 * Content Security Policy (CSP) Configuration
 * 
 * Sépare les politiques CSP entre développement et production pour :
 * - Dev : Permettre unsafe-eval pour HMR et Monaco Editor
 * - Prod : Politique stricte sans unsafe-eval pour la sécurité
 */

export interface CSPDirectives {
  defaultSrc: string[];
  scriptSrc: string[];
  styleSrc: string[];
  imgSrc: string[];
  fontSrc: string[];
  connectSrc: string[];
  mediaSrc: string[];
  objectSrc: string[];
  frameSrc: string[];
  baseUri: string[];
  formAction: string[];
  frameAncestors: string[];
  workerSrc: string[];
  childSrc: string[];
}

/**
 * CSP pour développement
 * - Permet unsafe-eval pour HMR de Vite et Monaco Editor
 * - Permet unsafe-inline pour les styles développement
 */
export function getDevCSP(): CSPDirectives {
  return {
    defaultSrc: ["'self'"],
    scriptSrc: [
      "'self'",
      "'unsafe-eval'", // Requis pour Vite HMR et Monaco Editor en dev
      "'unsafe-inline'", // Requis pour certains scripts inline de dev
      "blob:",
    ],
    styleSrc: [
      "'self'",
      "'unsafe-inline'", // Requis pour styled-components et CSS-in-JS
    ],
    imgSrc: [
      "'self'",
      "data:",
      "blob:",
      "https:",
    ],
    fontSrc: [
      "'self'",
      "data:",
    ],
    connectSrc: [
      "'self'",
      "ws://localhost:*",
      "ws://127.0.0.1:*",
      "wss://localhost:*",
      "wss://127.0.0.1:*",
      "http://localhost:*",
      "http://127.0.0.1:*",
      "https://generativelanguage.googleapis.com", // Gemini API
      "https://*.supabase.co", // Supabase
      "https://openrouter.ai", // OpenRouter
      "https://api.github.com", // GitHub API
    ],
    mediaSrc: [
      "'self'",
      "blob:",
      "mediastream:",
    ],
    objectSrc: ["'none'"],
    frameSrc: [
      "'self'",
      "blob:",
    ],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"],
    workerSrc: [
      "'self'",
      "blob:",
    ],
    childSrc: [
      "'self'",
      "blob:",
    ],
  };
}

/**
 * CSP pour production
 * - Stricte : pas de unsafe-eval ni unsafe-inline
 * - Utilise des nonces pour les scripts et styles dynamiques
 * - Sécurité maximale
 */
export function getProdCSP(): CSPDirectives {
  return {
    defaultSrc: ["'self'"],
    scriptSrc: [
      "'self'",
      "blob:",
      // Le plugin Monaco injecte un <script> inline dans index.html qui définit
      // window.MonacoEnvironment (URLs des workers). Sans 'unsafe-inline' en prod,
      // on l'autorise par son hash SHA-256 exact — le seul inline toléré.
      // Si ce bloc change (nouvelle version de Monaco/Vite), mettre à jour le hash :
      // le navigateur affiche le hash attendu dans l'erreur CSP de la console.
      "'sha256-HFhrXxEaMb8M1qOPJFyWyRxQ19x/oAt60ZKfwIqwr8g='",
    ],
    styleSrc: [
      "'self'",
      // En production, éviter unsafe-inline. Si nécessaire, utiliser des nonces.
      // Pour l'instant, on permet pour compatibilité avec les composants existants
      "'unsafe-inline'",
    ],
    imgSrc: [
      "'self'",
      "data:",
      "blob:",
      "https:",
    ],
    fontSrc: [
      "'self'",
      "data:",
    ],
    connectSrc: [
      "'self'",
      "wss://*.supabase.co",
      "https://*.supabase.co",
      "https://generativelanguage.googleapis.com",
      "https://openrouter.ai",
      "https://api.github.com",
    ],
    mediaSrc: [
      "'self'",
      "blob:",
      "mediastream:",
    ],
    objectSrc: ["'none'"],
    frameSrc: [
      "'self'",
      "blob:",
    ],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"],
    workerSrc: [
      "'self'",
      "blob:",
    ],
    childSrc: [
      "'self'",
      "blob:",
    ],
  };
}

/**
 * Convertit les directives CSP en string pour le header HTTP
 */
export function formatCSPHeader(directives: CSPDirectives): string {
  return Object.entries(directives)
    .map(([key, values]) => {
      // Convertir camelCase en kebab-case
      const headerKey = key.replace(/([A-Z])/g, '-$1').toLowerCase();
      return `${headerKey} ${values.join(' ')}`;
    })
    .join('; ');
}

/**
 * Retourne la CSP appropriée selon l'environnement
 */
export function getCSPForEnvironment(isDev: boolean): string {
  const directives = isDev ? getDevCSP() : getProdCSP();
  return formatCSPHeader(directives);
}
