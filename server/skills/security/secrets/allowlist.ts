/**
 * allowlist — Filtre de faux positifs et valeurs autorisées pour la détection de secrets
 */

// Chaines et motifs considérés comme fictifs, de test ou d'exemple
export const ALLOWED_PATTERNS = [
  /AKIAIOSFODNN7EXAMPLE/i,
  /wJalrXUtnFEMI\/K7MDENG\/bPxRfiCYEXAMPLEKEY/i,
  /your[_-]?(?:api)?[_-]?key/i,
  /placeholder/i,
  /dummy[_-]?token/i,
  /<YOUR[_-]?.*?>/i,
  /00000000-0000-0000-0000-000000000000/,
  /test_key_[a-zA-Z0-9]+/i,
  /mock[_-]?token/i,
  /example\.com/i,
];

// Fichiers autorisés à contenir des mocks ou exemples
export const ALLOWED_PATHS = [
  /\.env\.example$/i,
  /\.env\.test$/i,
  /\.test\.[jt]sx?$/i,
  /\.spec\.[jt]sx?$/i,
  /__tests__\//i,
  /__mocks__\//i,
  /fixtures\//i,
];

export function isAllowedSecret(value: string, filePath: string): boolean {
  if (ALLOWED_PATHS.some((re) => re.test(filePath))) {
    return true;
  }
  if (ALLOWED_PATTERNS.some((re) => re.test(value))) {
    return true;
  }
  return false;
}
