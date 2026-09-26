/**
 * templateVariables.ts — Engine for dynamic variable extraction and substitution in templates.
 *
 * Supports both `{variable}` and `{{variable}}` syntax.
 */

export interface VariableMeta {
  key: string;
  label: string;
  defaultValue: string;
  description?: string;
}

/**
 * Standard variable definitions with smart default resolvers.
 */
export function getDefaultVariableValues(userName?: string, projectName?: string): Record<string, string> {
  const today = new Date();
  const formattedDate = today.toLocaleDateString('fr-FR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return {
    nom_projet: projectName || 'Leanna App',
    date: formattedDate,
    auteur: userName || 'Équipe Leanna',
    version: '1.0.0',
    entreprise: 'Leanna Inc.',
    description: 'Description synthétique de la fonctionnalité ou du projet.',
    stack: 'TypeScript, React, Node.js, Gemini API',
    cible: 'Utilisateurs finaux & développeurs',
    responsable: userName || 'Chef de projet',
  };
}

/**
 * Extract all unique variable placeholder keys from a template string.
 * Matches {var_name} or {{var_name}}.
 */
export function extractVariables(templateContent: string): string[] {
  const regex = /\{\{?\s*([a-zA-Z0-9_-]+)\s*\}?\}/g;
  const matches = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = regex.exec(templateContent)) !== null) {
    if (match[1]) {
      matches.add(match[1].toLowerCase());
    }
  }

  return Array.from(matches);
}

/**
 * Interpolates variables into a template string.
 */
export function renderTemplate(
  templateContent: string,
  variables: Record<string, string>
): string {
  if (!templateContent) return '';

  return templateContent.replace(/\{\{?\s*([a-zA-Z0-9_-]+)\s*\}?\}/g, (fullMatch, key) => {
    const lowerKey = key.toLowerCase();
    if (lowerKey in variables && variables[lowerKey] !== undefined && variables[lowerKey] !== '') {
      return variables[lowerKey];
    }
    return fullMatch;
  });
}
