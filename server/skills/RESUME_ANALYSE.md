# Résumé de l'analyse et Implémentation de l'Auto-Guérison

## Contexte
Maysson a demandé une analyse des compétences ("skills") du projet Leanna , avec pour objectif de permettre à l'IA de les mettre à jour ou d'en créer de nouvelles suite à la résolution de problèmes.

## Structure actuelle
L'analyse a commencé par l'exploration des dossiers :
- `src/skills` : Contient des fichiers comme `customSkillsAccess.ts` et `database.ts`.
- `server/skills` : Dossier principal contenant de nombreuses compétences (git, automation, codebase, etc.) et le `SkillManager.ts`.

## SkillManager.ts - Analyse Initial
Ce fichier est central. Il gère :
- La classification dynamique des outils via des mots-clés (`TOOL_KEYWORDS`)
- Le chargement des compétences critiques au démarrage
- La découverte dynamique ("lazy loading") des autres compétences
- Un système d'auto-guérison existant basé sur la réparation de fichiers

## Implémentation Réalisée

### Nouveau Mécanisme d'Auto-Guérison Avancé

Le système a été étendu avec un mécanisme d'analyse stratégique des erreurs d'outils qui **complète** la réparation de fichiers existante.

#### Nouvelles Capacités :

1. **Analyse des Erreurs d'Outils** (`analyzeToolErrorAndProposeAlternatives`)
   - Classification automatique des types d'erreurs (TOOL_NOT_FOUND, PERMISSION_ERROR, TIMEOUT_ERROR, etc.)
   - Extraction du contexte de l'erreur pour une meilleure compréhension

2. **Recherche d'Outils Similaires** (`findSimilarTools`)
   - Analyse sémantique des noms d'outils
   - Calcul de score de similarité basé sur :
     - Mots-clés communs
     - Préfixes/suffixes similaires
     - Catégorie sémantique (via TOOL_KEYWORDS)
   - Proposition des outils existants les plus proches

3. **Suggestions de Solutions** (`suggestWorkarounds`)
   - Solutions spécifiques par type d'erreur
   - Suggestions contextuelles basées sur le nom de l'outil

4. **Proposition de Création de Nouvelles Skills**
   - Détection des outils manquants
   - Suggestion de la catégorie de skill appropriée
   - Basé sur l'analyse des mots-clés TOOL_KEYWORDS

5. **Historique des Analyses**
   - Stockage des analyses d'erreurs pour suivi
   - Identification des patterns d'erreurs récurrentes
   - Limité à 20 entrées pour éviter la surcharge mémoire

#### Interfaces Exportées :

```typescript
// Représente une proposition d'alternative
export interface ToolAlternativeProposal {
  type: 'existing_tool' | 'new_skill' | 'workaround';
  toolName?: string;
  skillName?: string;
  description: string;
  confidence: number;  // Score de confiance (0-1)
  reasoning: string;   // Explication de la proposition
}

// Résultat complet de l'analyse
export interface ToolErrorAnalysis {
  errorMessage: string;
  errorType: string;           // Ex: 'TOOL_NOT_FOUND', 'PERMISSION_ERROR'
  failedTool: string;
  failedSkill?: string;
  proposals: ToolAlternativeProposal[];
  timestamp: number;
}
```

#### Méthodes Publiques Ajoutées :

- `getToolErrorAnalyses()`: Récupère l'historique des analyses
- `analyzeToolProactively(toolName, description?)`: Analyse proactive d'un outil
- `getToolAlternatives(toolName)`: Obtient les alternatives pour un outil

### Intégration dans handleToolCall

Le mécanisme a été intégré dans la méthode `handleToolCall` à l'endroit identifié dans l'analyse initiale (lignes 996-1005). Maintenant, lorsqu'une erreur se produit :

1. L'erreur est captée et loguée
2. **NOUVEAU**: L'analyse des alternatives est lancée de manière asynchrone
3. Les propositions sont affichées dans les logs avec leur score de confiance
4. L'analyse est stockée pour consultation ultérieure
5. La réparation classique du fichier (`selfHealSkill`) est toujours exécutée
6. L'erreur originale est re-throwée (comportement préservé)

```typescript
// Dans handleToolCall, lorsque qu'une erreur est captée :
this.analyzeToolErrorAndProposeAlternatives(normalizedName, error as Error, skillItem.path)
  .then((analysis) => {
    // Afficher les propositions
    if (analysis.proposals && analysis.proposals.length > 0) {
      console.log(`[Auto-Guerison] Propositions d'alternatives pour '${normalizedName}':`);
      analysis.proposals.forEach((proposal, index) => {
        console.log(`  ${index + 1}. [${proposal.type}] ${proposal.description} (confiance: ${(proposal.confidence * 100).toFixed(0)}%)`);
      });
      this.storeToolErrorAnalysis(analysis);
    }
    return this.selfHealSkill(skillItem.path, error as Error, context);
  })
  .catch(() => {
    // Fallback vers la réparation classique
    return this.selfHealSkill(skillItem.path, error as Error, context);
  });
```

### Types d'Erreurs Gérés

Le système classe automatiquement les erreurs dans les catégories suivantes :
- `TOOL_NOT_FOUND`: Outil inconnu ou non trouvé
- `PERMISSION_ERROR`: Problèmes d'accès ou de permissions
- `TIMEOUT_ERROR`: Dépassement de temps
- `NETWORK_ERROR`: Problèmes de réseau
- `IMPLEMENTATION_ERROR`: Bugs d'implémentation
- `SYNTAX_ERROR`: Erreurs de syntaxe
- `VALIDATION_ERROR`: Problèmes de validation
- `RATE_LIMIT_ERROR`: Limite de taux dépassée
- `GENERIC_ERROR`: Autres erreurs

### Exemple de Sortie

```
[SkillManager] Erreur dans my_tool (mySkill.ts): Outil inconnu
[Auto-Guerison] Analyse complète pour l'outil 'my_tool': {
  errorType: 'TOOL_NOT_FOUND',
  proposalCount: 3,
  topProposal: 'existing_tool'
}
[Auto-Guerison] Propositions d'alternatives pour 'my_tool':
  1. [existing_tool] Utiliser l'outil similaire 'similar_tool' depuis la skill 'codebase' (confiance: 75%)
     → Raison: L'outil 'similar_tool' a des fonctionnalités similaires
  2. [new_skill] Créer une nouvelle skill 'custom_skills' pour gérer cet outil (confiance: 80%)
     → Raison: L'erreur indique que l'outil est inconnu
  3. [workaround] Vérifier si l'outil existe avec une autre casse (confiance: 60%)
     → Raison: Certains outils peuvent être appelés avec des variations de nom
```

## Avantages de l'Implémentation

1. **Non-intrusif**: Le comportement existant est préservé, le nouveau mécanisme s'exécute en parallèle
2. **Sûr**: Toutes les analyses sont effectuées de manière asynchrone et ne bloquent pas l'exécution
3. **Extensible**: Les interfaces sont exportées pour permettre une intégration future avec d'autres systèmes
4. **Apprentissage**: L'historique des analyses permet d'identifier les erreurs récurrentes
5. **Transparence**: Les propositions sont clairement loguées pour aider au débogage

## Prochaines Évolutions Possibles

1. **Création Automatique de Skills**: Étendre le système pour générer automatiquement des templates de skills
2. **Apprentissage Continu**: Utiliser l'historique pour améliorer les suggestions
3. **Intégration avec l'IA**: Permettre à l'IA d'interroger directement ce système pour prendre des décisions
4. **Notifications Proactives**: Notifier l'utilisateur des alternatives disponibles
5. **Auto-réparation Avancée**: Combiner l'analyse des alternatives avec la création automatique de skills

## Conclusion

L'implémentation répond directement au besoin de Maysson : le système ne se contente plus de réparer les fichiers en erreur, mais **analyse stratégiquement les problèmes** et **propose des alternatives** (outils existants ou création de nouvelles skills). Le mécanisme est intégré de manière transparente dans le `SkillManager` existant, préservant toute la fonctionnalité actuelle tout en ajoutant cette nouvelle couche d'intelligence.