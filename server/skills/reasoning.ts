import { Skill } from "./base.js";
import fs from "fs";
import { generateText, generateTextStream, getActiveProvider, type GenerateTextResult } from "../utils/textGeneration.js";
import { ChainOfThoughtExecutor, assessComplexity, type ComplexityLevel } from "./chainOfThought.js";

// ─── Configuration ──────────────────────────────────────────────────────────

const ANNOUNCEMENT_MAX_CHARS = 220;
const REASONING_CACHE_TTL_MS = 60_000;
const reasoningCache = new Map<string, { expiresAt: number; result: GenerateTextResult }>();

import { getProjectRoot, normalizeProjectPath } from "./codebaseHelpers.js";

function parseReasoningListCommand(command: unknown): string | null {
  if (typeof command !== "string") return null;
  const match = /^(?:dir|ls)(?:\s+(.+?))?\s*$/i.exec(command);
  return match ? (match[1]?.trim() || "") : null;
}

function reasoningCacheKey(strategy: string, prompt: string): string {
  return `${strategy}:${prompt.trim().replace(/\s+/g, " ").toLowerCase()}`;
}

function reasoningBudget(complexity: ComplexityLevel): { thinkingBudget: number; maxOutputTokens: number } {
  if (complexity === "critical") return { thinkingBudget: 8_192, maxOutputTokens: 16_384 };
  if (complexity === "complex") return { thinkingBudget: 4_096, maxOutputTokens: 12_288 };
  if (complexity === "moderate") return { thinkingBudget: 2_048, maxOutputTokens: 8_192 };
  return { thinkingBudget: 512, maxOutputTokens: 4_096 };
}

function extractConfidence(text: string): "low" | "medium" | "high" | null {
  const match = /(?:niveau de confiance|confidence level)\s*[:\-]?\s*(élev[ée]e?|high|moyenne?|medium|faible|low)/i.exec(text);
  if (!match) return null;
  const value = match[1].toLowerCase();
  if (/faible|low/.test(value)) return "low";
  if (/moyenne?|medium/.test(value)) return "medium";
  return "high";
}

function parseWinner(text: string): number {
  const jsonWinner = /"winner"\s*:\s*([1-3])/i.exec(text);
  const labelledWinner = /(?:winner|gagnante?|retenue)\s*[:#]?\s*(?:approach|approche|branch|branche)?\s*([1-3])/i.exec(text);
  const winner = jsonWinner?.[1] || labelledWinner?.[1];
  return winner ? Number(winner) : 1;
}

async function runTreeOfThought(prompt: string, budget: ReturnType<typeof reasoningBudget>): Promise<GenerateTextResult & { evaluation: string; winner: number }> {
  const temperatures = [0.3, 0.7, 1.0];
  const branchPrompt = (index: number) =>
    `Tu es la branche ${index} d'une exploration indépendante. Génère UNE approche complète et distincte pour résoudre le problème ci-dessous. Ne compare pas d'autres branches, ne justifie pas leur absence et termine par un plan exécutable.\n\nPROBLÈME :\n${prompt}`;

  // Promise.allSettled (au lieu de Promise.all) : une branche qui échoue
  // (quota, timeout, provider indisponible) ne doit pas faire perdre les
  // branches qui ont réussi. Le module chainOfThought.ts applique déjà ce
  // principe de "gestion granulaire des erreurs" ; runTreeOfThought ne le
  // faisait pas, alors qu'il représente le chemin le plus coûteux (3 appels
  // en parallèle) et donc le plus exposé au risque de panne partielle.
  const settled = await Promise.allSettled(
    temperatures.map((temperature, index) =>
      generateText({
        prompt: branchPrompt(index + 1),
        systemPrompt: THINKING_STRATEGIES.tree_of_thought.systemPrompt,
        temperature,
        ...budget,
      })
    )
  );

  const branches: { index: number; result: GenerateTextResult }[] = [];
  const branchErrors: string[] = [];
  settled.forEach((outcome, index) => {
    if (outcome.status === "fulfilled") {
      branches.push({ index, result: outcome.value });
    } else {
      branchErrors.push(`Branche ${index + 1}: ${(outcome.reason as Error)?.message ?? outcome.reason}`);
    }
  });

  if (branches.length === 0) {
    throw new Error(`Toutes les branches Tree-of-Thought ont échoué. ${branchErrors.join(" | ")}`);
  }

  // Une seule branche a survécu : rien à évaluer, on la retourne directement
  // plutôt que de payer un appel d'évaluation inutile sur un unique candidat.
  if (branches.length === 1) {
    const only = branches[0];
    return {
      ...only.result,
      evaluation: `Une seule branche disponible (${branchErrors.join(" | ")}), retenue par défaut.`,
      winner: only.index + 1,
    };
  }

  const evaluationPrompt = branches
    .map(({ index, result }) => `APPROCHE ${index + 1}:\n${result.text}`)
    .join("\n\n");
  const evaluation = await generateText({
    prompt: `Évalue ces approches indépendantes (${branches.length} sur 3 disponibles${branchErrors.length ? "; " + branchErrors.join(" | ") : ""}). Réponds d'abord en JSON strict {"winner":1|2|3,"reasoning":"..."} en utilisant le numéro d'approche indiqué ci-dessous, puis explique brièvement le choix. Note faisabilité, risques, complexité et réversibilité.\n\n${evaluationPrompt}`,
    systemPrompt: "Tu es un évaluateur indépendant et exigeant. Sélectionne la meilleure approche, sans réécrire les branches.",
    temperature: 0.2,
    ...budget,
  });
  const winner = parseWinner(evaluation.text);
  const winningBranch = branches.find((b) => b.index + 1 === winner) ?? branches[0];
  return { ...winningBranch.result, evaluation: evaluation.text, winner: winningBranch.index + 1 };
}

async function runSelfCritique(prompt: string, initial: GenerateTextResult, budget: ReturnType<typeof reasoningBudget>): Promise<GenerateTextResult> {
  const critiqueProvider = getActiveProvider() === "gemini" ? "openrouter" : "gemini";
  const critique = await generateText({
    prompt: `Critique indépendamment la solution suivante. Identifie les erreurs factuelles, hypothèses non vérifiées, cas limites et omissions. Ne propose pas encore de réécriture.\n\nPROBLÈME :\n${prompt}\n\nSOLUTION :\n${initial.text}`,
    systemPrompt: "Tu es un réviseur indépendant, sceptique et précis.",
    temperature: 0.4,
    forceProvider: critiqueProvider,
    ...budget,
  });
  return generateText({
    prompt: `Corrige la solution à partir de la critique indépendante. Retourne uniquement la solution finale complète, avec un niveau de confiance explicite.\n\nPROBLÈME :\n${prompt}\n\nSOLUTION INITIALE :\n${initial.text}\n\nCRITIQUE :\n${critique.text}`,
    systemPrompt: "Tu es un expert chargé de produire la version corrigée et directement exploitable.",
    temperature: 0.3,
    ...budget,
  });
}

// ─── Thinking Strategies ────────────────────────────────────────────────────

type ThinkingStrategy =
  | "chain_of_thought"
  | "decomposition"
  | "analogical"
  | "self_critique"
  | "first_principles"
  | "tree_of_thought"
  | "document_analysis"
  | "comparative_analysis"
  | "root_cause_analysis"
  | "auto";

interface ThinkingConfig {
  strategy: ThinkingStrategy;
  label: string;
  description: string;
  systemPrompt: string;
}

const THINKING_STRATEGIES: Record<Exclude<ThinkingStrategy, "auto">, ThinkingConfig> = {
  chain_of_thought: {
    strategy: "chain_of_thought",
    label: "Chain of Thought",
    description: "Raisonnement étape par étape, chaque étape découlant logiquement de la précédente.",
    systemPrompt: `Tu es un expert en raisonnement logique et en analyse documentaire. Résous le problème ci-dessous en utilisant une approche Chain of Thought :

INSTRUCTIONS :
1. Reformule le problème avec tes propres mots pour confirmer ta compréhension.
2. Identifie les données clés et les contraintes.
3. Raisonne étape par étape. Numérote chaque étape et explique pourquoi elle découle de la précédente.
4. Si tu fais une hypothèse, annonce-la explicitement.
5. Termine par une conclusion claire et concise, séparée du raisonnement.

CONSIDÉRATIONS DOCUMENTAIRES (si le problème implique un/des documents) :
- Cite les passages ou sections pertinentes pour ancrer ton raisonnement.
- Distingue les FAITS (ce que dit le document) de tes INTERPRÉTATIONS.
- Si le document contient des ambiguïtés, signale-les à chaque étape concernée.
- Vérifie la cohérence entre les différentes parties du document à chaque étape.

FORMAT DE RÉPONSE :
## Compréhension du problème
(reformulation)

## Raisonnement étape par étape
Étape 1: ...
Étape 2: ...
...

## Conclusion
(réponse finale)`,
  },

  decomposition: {
    strategy: "decomposition",
    label: "Décomposition",
    description: "Divise un problème complexe en sous-problèmes indépendants, résout chacun, puis synthétise.",
    systemPrompt: `Tu es un expert en résolution de problèmes complexes et en structuration documentaire. Utilise la méthode de décomposition :

INSTRUCTIONS :
1. Identifie le problème principal.
2. Décompose-le en sous-problèmes indépendants et gérables (maximum 5).
3. Résous chaque sous-problème séparément avec un raisonnement clair.
4. Synthétise les résultats partiels en une solution cohérente.
5. Vérifie que la synthèse répond bien au problème initial.

CONSIDÉRATIONS DOCUMENTAIRES (si le problème implique un/des documents) :
- Décompose selon la structure logique du document (sections, chapitres, thèmes) plutôt qu'arbitrairement.
- Pour chaque sous-partie, identifie : contenu factuel, arguments, conclusions locales.
- Lors de la synthèse, vérifie qu'il n'y a pas de contradictions entre les sous-parties.
- Signale les dépendances croisées entre sections (ex: une conclusion en section 3 repose sur des données de section 1).

FORMAT DE RÉPONSE :
## Problème principal
(énoncé clair)

## Décomposition
### Sous-problème 1: ...
**Résolution:** ...

### Sous-problème 2: ...
**Résolution:** ...

(etc.)

## Synthèse
(solution combinée)

## Vérification
(la solution répond-elle au problème initial ?)`,
  },

  analogical: {
    strategy: "analogical",
    label: "Raisonnement par analogie",
    description: "Trouve des parallèles avec des problèmes connus pour transférer des solutions.",
    systemPrompt: `Tu es un expert en raisonnement analogique. Résous le problème en trouvant des parallèles :

INSTRUCTIONS :
1. Identifie la structure abstraite du problème (quels sont les éléments et relations clés ?).
2. Trouve 1 à 3 analogies pertinentes avec des domaines ou problèmes connus.
3. Pour chaque analogie, explique le mapping : quel élément correspond à quoi.
4. Transfère la solution du domaine analogique au problème original.
5. Vérifie les limites de l'analogie : où le parallèle cesse-t-il d'être valide ?

FORMAT DE RÉPONSE :
## Structure du problème
(abstraction)

## Analogies identifiées
### Analogie 1: [domaine source]
- Mapping: ...
- Solution dans ce domaine: ...
- Transfert au problème: ...

## Solution proposée
(basée sur le meilleur transfert analogique)

## Limites
(où l'analogie ne tient plus)`,
  },

  self_critique: {
    strategy: "self_critique",
    label: "Auto-critique itérative",
    description: "Propose une solution, la critique, l'améliore, en boucle jusqu'à convergence.",
    systemPrompt: `Tu es un expert en pensée critique et en révision documentaire. Résous le problème en utilisant un processus d'auto-critique itérative :

INSTRUCTIONS :
1. Propose une première solution (rapide, intuitive).
2. Critique cette solution : quelles sont ses failles, hypothèses non vérifiées, cas limites ?
3. Propose une solution améliorée qui adresse les critiques.
4. Critique à nouveau : reste-t-il des faiblesses ?
5. Si oui, itère une dernière fois. Sinon, finalise.

CONSIDÉRATIONS DOCUMENTAIRES (si le problème implique un/des documents) :
- Vérifie l'exactitude factuelle : les données citées sont-elles correctes et à jour ?
- Vérifie la cohérence interne : pas de contradictions entre sections.
- Vérifie la complétude : les informations essentielles sont-elles toutes présentes ?
- Vérifie la clarté : un lecteur non-expert comprendrait-il chaque partie ?
- Vérifie le ton et le registre : sont-ils adaptés au public cible ?

FORMAT DE RÉPONSE :
## Première tentative
(solution intuitive)

## Critique #1
- Faille: ...
- Faille: ...

## Deuxième tentative
(solution améliorée)

## Critique #2
- Point résolu: ...
- Faiblesse restante: ...

## Solution finale
(version la plus robuste)

## Niveau de confiance
(élevé / moyen / faible, et pourquoi)`,
  },

  first_principles: {
    strategy: "first_principles",
    label: "Premiers principes",
    description: "Remonte aux vérités fondamentales, élimine les suppositions, reconstruit depuis la base.",
    systemPrompt: `Tu es un expert en raisonnement par premiers principes (à la manière d'Elon Musk ou Aristote). Résous le problème en remontant aux fondamentaux :

INSTRUCTIONS :
1. Identifie les suppositions communes sur ce sujet.
2. Remets en question chaque supposition : est-elle vraiment nécessaire ?
3. Identifie les vérités fondamentales et indiscutables (les "premiers principes").
4. Reconstruis une solution uniquement à partir de ces premiers principes.
5. Compare avec l'approche conventionnelle : qu'apporte ta solution de différent ?

FORMAT DE RÉPONSE :
## Suppositions courantes
1. ...
2. ...

## Remise en question
- Supposition 1: [vraie/fausse/partielle] parce que...
- Supposition 2: ...

## Premiers principes identifiés
1. (vérité fondamentale)
2. ...

## Reconstruction depuis la base
(solution construite uniquement sur les premiers principes)

## Comparaison avec l'approche conventionnelle
(avantages / inconvénients de la nouvelle approche)`,
  },

  tree_of_thought: {
    strategy: "tree_of_thought",
    label: "Tree of Thought",
    description: "Explore plusieurs branches de raisonnement en parallèle, évalue chacune, sélectionne la meilleure avant d'agir. Idéal pour les tâches critiques ou à fort enjeu.",
    systemPrompt: `Tu es un stratège expert en résolution de problèmes critiques. Pour le problème donné, tu dois explorer 3 approches distinctes avant de choisir la meilleure.

INSTRUCTIONS :
1. Génère 3 approches fondamentalement différentes (pas de variantes mineures).
2. Pour chaque approche, évalue : faisabilité, risques, complexité, réversibilité.
3. Score chaque approche sur 10.
4. Sélectionne l'approche avec le meilleur rapport bénéfice/risque.
5. Développe un plan d'exécution détaillé pour l'approche retenue.

FORMAT DE RÉPONSE :
## Approche A : [nom court]
[description en 2-3 phrases]
- Avantages : ...
- Risques : ...
- Faisabilité : [haute/moyenne/basse]
- Score : [0-10]

## Approche B : [nom court]
[description en 2-3 phrases]
- Avantages : ...
- Risques : ...
- Faisabilité : [haute/moyenne/basse]
- Score : [0-10]

## Approche C : [nom court]
[description en 2-3 phrases]
- Avantages : ...
- Risques : ...
- Faisabilité : [haute/moyenne/basse]
- Score : [0-10]

## ✅ Approche retenue : [A/B/C] — [nom]
**Raison du choix :** [justification en 1-2 phrases]

## Plan d'exécution détaillé
1. ...
2. ...
(chaque étape inclut une vérification)

## Points de vigilance
- ...`,
  },

  document_analysis: {
    strategy: "document_analysis",
    label: "Analyse documentaire",
    description: "Stratégie spécialisée pour le traitement de documents : synthèse, extraction d'information, vérification de cohérence, restructuration, annotation et conformité.",
    systemPrompt: `Tu es un expert en analyse et traitement documentaire. Tu excelles en synthèse, extraction d'information clé, vérification de cohérence, détection d'incohérences et restructuration de contenu.

INSTRUCTIONS :
1. Identifie le TYPE de document (rapport, contrat, note, procédure, courrier, étude, présentation, etc.) et son OBJECTIF.
2. Extrais la STRUCTURE existante (sections, hiérarchie, flux logique).
3. Identifie les ÉLÉMENTS CLÉS : thèse principale, arguments, données chiffrées, conclusions, engagements, dates limites, parties prenantes.
4. Détecte les PROBLÈMES éventuels : incohérences internes, informations manquantes, ambiguïtés, contradictions entre sections, termes imprécis.
5. Propose des AMÉLIORATIONS concrètes avec localisation précise (section/paragraphe concerné).

PRINCIPES DOCUMENTAIRES :
- Fidélité : ne jamais inventer d'information absente du document source.
- Traçabilité : chaque observation doit être rattachée à une section/passage précis.
- Exhaustivité : couvrir l'ensemble du document, pas seulement les premières pages.
- Neutralité : séparer les faits des interprétations.
- Priorisation : classer les observations par impact (critique → mineur).

FORMAT DE RÉPONSE :
## Identification du document
- Type : ...
- Objectif : ...
- Public cible : ...
- Volume : ... (sections/pages/mots estimés)

## Structure et flux logique
(description de l'architecture du document)

## Éléments clés extraits
1. **[Catégorie]** : [élément] — Section [X]
2. ...

## Diagnostic
### Incohérences / Problèmes détectés
- 🔴 [Critique] : ... (Section X)
- 🟡 [Modéré] : ... (Section Y)
- 🟢 [Mineur] : ... (Section Z)

### Informations manquantes
- ...

## Recommandations
1. [Action prioritaire] — Impact : [élevé/moyen] — Effort : [faible/moyen/élevé]
2. ...

## Synthèse en une phrase
(résumé exécutif du diagnostic)`,
  },

  comparative_analysis: {
    strategy: "comparative_analysis",
    label: "Analyse comparative",
    description: "Compare, croise et réconcilie plusieurs documents, versions ou sources d'information. Identifie convergences, divergences et contradictions.",
    systemPrompt: `Tu es un expert en analyse comparative de documents. Tu excelles à croiser des sources, identifier des divergences, et produire une vue unifiée et fiable.

INSTRUCTIONS :
1. Identifie les SOURCES à comparer (documents, versions, sections, ou données).
2. Établis un CADRE DE COMPARAISON : quels critères/dimensions utiliser pour comparer ?
3. Pour chaque critère, identifie les CONVERGENCES (points d'accord) et les DIVERGENCES (désaccords, écarts, contradictions).
4. Évalue la FIABILITÉ de chaque source sur les points de divergence (date, auteur, niveau de détail, cohérence interne).
5. Propose une POSITION DE SYNTHÈSE qui réconcilie les sources ou explique pourquoi la réconciliation est impossible.
6. Signale les ZONES D'OMBRE : sujets couverts par une source mais absents de l'autre.

PRINCIPES DE COMPARAISON :
- Équité : ne pas favoriser une source a priori.
- Granularité : comparer au niveau le plus fin pertinent (phrase, donnée chiffrée, date).
- Contexte : une divergence peut être légitime si les contextes diffèrent (date, périmètre, audience).
- Transparence : toujours indiquer le degré de certitude de chaque conclusion.

FORMAT DE RÉPONSE :
## Sources identifiées
| # | Source | Type | Date | Périmètre |
|---|--------|------|------|-----------|
| 1 | ... | ... | ... | ... |
| 2 | ... | ... | ... | ... |

## Cadre de comparaison
Critères retenus : [liste des dimensions de comparaison]

## Matrice de comparaison
### Critère 1 : [nom]
- **Source 1** : ...
- **Source 2** : ...
- **Verdict** : [convergence ✅ | divergence ⚠️ | contradiction ❌]

### Critère 2 : [nom]
...

## Synthèse des divergences
| Critère | Nature de l'écart | Source la plus fiable | Confiance |
|---------|-------------------|-----------------------|-----------|
| ... | ... | ... | élevée/moyenne/faible |

## Zones d'ombre
- [Sujet X] : couvert uniquement par Source 1, absent de Source 2.
- ...

## Position de synthèse recommandée
(version réconciliée ou explication de l'impossibilité de réconcilier)

## Points nécessitant une vérification humaine
- ...`,
  },

  root_cause_analysis: {
    strategy: "root_cause_analysis",
    label: "Analyse des causes racines",
    description: "Remonte méthodiquement (5 Pourquoi / Ishikawa) d'un symptôme observé à sa cause profonde, pour éviter de traiter uniquement les effets. Idéal pour incidents, bugs récurrents, pannes ou dysfonctionnements.",
    systemPrompt: `Tu es un expert en analyse de causes racines (méthode des "5 Pourquoi" et diagramme d'Ishikawa). Ton objectif est de ne jamais t'arrêter au premier symptôme.

INSTRUCTIONS :
1. Décris précisément le SYMPTÔME observé (ce qui a été constaté, avec faits et données si disponibles).
2. Applique la méthode des 5 Pourquoi : pour chaque réponse, demande à nouveau "pourquoi" jusqu'à atteindre une cause qui, si elle est corrigée, empêche la récurrence du symptôme.
3. Si plusieurs causes potentielles existent en parallèle, structure-les selon les catégories d'Ishikawa pertinentes (Méthode, Matériel/Outils, Main-d'œuvre/Humain, Milieu/Environnement, Mesure/Données, Management/Process — ne garde que les catégories pertinentes).
4. Distingue la CAUSE RACINE (structurelle, systémique) des causes immédiates ou déclencheurs (symptomatiques).
5. Propose une action corrective pour la cause racine ET, si utile, une action palliative immédiate pour limiter les dégâts en attendant.
6. Vérifie ta chaîne causale : chaque "pourquoi" découle-t-il logiquement et factuellement du précédent, ou y a-t-il un saut non justifié ?

PRINCIPES :
- Ne pas s'arrêter à la première explication plausible : viser la cause structurelle, pas le premier coupable apparent.
- Séparer les FAITS observés des HYPOTHÈSES non vérifiées ; signaler clairement ces dernières.
- Éviter d'attribuer la cause uniquement à une "erreur humaine" sans creuser le processus ou le contexte qui l'a permise.
- Si les informations sont insuffisantes pour conclure avec certitude, le dire explicitement plutôt que d'inventer.

FORMAT DE RÉPONSE :
## Symptôme observé
(description factuelle)

## Chaîne des 5 Pourquoi
1. Pourquoi [symptôme] ? → ...
2. Pourquoi cela ? → ...
3. Pourquoi cela ? → ...
4. Pourquoi cela ? → ...
5. Pourquoi cela ? → ...

## Cause(s) racine(s) identifiée(s)
- ...

## Causes immédiates / déclencheurs (à distinguer de la cause racine)
- ...

## Actions recommandées
- **Corrective (cause racine)** : ...
- **Palliative (immédiate)** : ...

## Niveau de confiance
(élevé / moyen / faible — et ce qu'il faudrait vérifier pour l'augmenter)`,
  },
};

// ─── Strategy Auto-Selection ────────────────────────────────────────────────

/**
 * Génère une explication courte et naturelle du pourquoi du raisonnement,
 * destinée à être prononcée vocalement.
 */
function buildReasoningExplanation(
  prompt: string | undefined,
  strategy: Exclude<ThinkingStrategy, "auto">,
  complexity: ComplexityLevel
): string {
  const lower = (prompt ?? "").toLowerCase();

  // Raisons basées sur la stratégie choisie
  const strategyReasons: Record<Exclude<ThinkingStrategy, "auto">, string> = {
    chain_of_thought: "Je vais raisonner étape par étape pour m'assurer de ne rien oublier.",
    decomposition: "Je décompose le document en sous-parties pour mieux le traiter.",
    analogical: "Je cherche des analogies avec des documents ou cas similaires que je connais.",
    self_critique: "Je vais vérifier ma réponse en la critiquant pour la rendre plus fiable.",
    first_principles: "Je remonte aux éléments fondamentaux pour construire une réponse solide.",
    tree_of_thought: "J'explore plusieurs approches en parallèle avant de choisir la meilleure.",
    document_analysis: "J'analyse le document en profondeur pour en extraire la structure et les éléments clés.",
    comparative_analysis: "Je croise les sources pour identifier les convergences et les écarts.",
    root_cause_analysis: "Je remonte étape par étape jusqu'à la cause racine, pas seulement le symptôme.",
  };

  // Raisons supplémentaires basées sur le contexte du prompt (usage documentaire)
  let contextReason = "";
  if (/confidentiel|sensible|conformit|juridique|contrat|rgpd|cnil|données personnelles/i.test(lower)) {
    contextReason = "Ce document touche à des informations sensibles ou confidentielles, je dois être particulièrement prudent.";
  } else if (/compar|croiser|différence|divergence|version|vs\b|versus|entre.*document/i.test(lower)) {
    contextReason = "Je compare les sources pour identifier les points de convergence et les contradictions.";
  } else if (/résum|synthès|condenser|essentiel|idée.?clé|point.?clé/i.test(lower)) {
    contextReason = "Une synthèse fiable demande d'identifier d'abord les idées clés avant de condenser.";
  } else if (/structur|organisat|plan\b|sommaire|table des matières|architecture du document/i.test(lower)) {
    contextReason = "C'est une question de structuration qui mérite une réflexion approfondie.";
  } else if (/réorganis|restructur|refonte|réécri|réécriture|remanier/i.test(lower)) {
    contextReason = "Cette réorganisation du document nécessite de bien planifier pour éviter les incohérences.";
  } else if (/cause (racine|profonde|première)|root cause|5 pourquoi|5 whys|panne récurrente|bug récurrent|incident récurrent/i.test(lower)) {
    contextReason = "Je remonte à la cause racine du problème avant de proposer une correction durable.";
  } else if (/incohérence|erreur|correction|contradiction|anomalie|coquille/i.test(lower)) {
    contextReason = "Pour identifier la source du problème, je dois analyser le document méthodiquement.";
  } else if (/plusieurs.*(document|section|fichier|page|source|version)/i.test(lower)) {
    contextReason = "Ça touche plusieurs documents ou sections, je dois coordonner les changements.";
  } else if (/extraire|extraction|identifier.*information|repérer|inventorier|lister.*éléments/i.test(lower)) {
    contextReason = "J'identifie et j'extrais les informations pertinentes de manière systématique.";
  } else if (/annoter|annotation|commentaire|marge|remarque|feedback/i.test(lower)) {
    contextReason = "J'annote le document de façon structurée pour faciliter la relecture.";
  } else if (/relire|relecture|proofreading|révision|qualité rédaction/i.test(lower)) {
    contextReason = "Une relecture rigoureuse nécessite de vérifier chaque section avec méthode.";
  } else if (/conformit|norme|iso|standard|réglementaire|audit|checklist/i.test(lower)) {
    contextReason = "Je vérifie la conformité point par point selon les critères applicables.";
  } else if (/classif|catégoris|trier|ranger|taxon|étiqueter|tag/i.test(lower)) {
    contextReason = "Je classe les éléments du document selon une logique cohérente.";
  } else if (complexity === "critical") {
    contextReason = "La complexité est critique, une approche structurée est indispensable.";
  }

  return contextReason || strategyReasons[strategy];
}

// ── Heuristiques pondérées ──────────────────────────────────────────────────
// Chaque stratégie porte une liste de motifs (regex, poids). Le score total
// d'une stratégie est la somme des poids des motifs qui matchent le prompt.
// La stratégie au score le plus élevé l'emporte, à condition de dépasser
// MIN_SCORE_THRESHOLD ; sinon on retombe sur chain_of_thought (le plus polyvalent).
// Ce système remplace l'ancienne chaîne de if/else ordonnée : il évite les biais
// d'ordre (un motif tardif ne peut plus être "masqué" par un motif antérieur trop
// large) et rend l'ajout d'une stratégie ou d'un mot-clé trivial et localisé.

interface StrategyPattern {
  regex: RegExp;
  weight: number;
}

const MIN_SCORE_THRESHOLD = 1;

const STRATEGY_PATTERNS: Record<Exclude<ThinkingStrategy, "auto">, StrategyPattern[]> = {
  comparative_analysis: [
    { regex: /compar(er|aison|atif|ative)|compar(e|ison|ative)/i, weight: 2 },
    { regex: /croiser|différence(s)?.*entre|divergence|version.*(précédente|antérieure|actuelle)|cross[- ]?check|difference(s)?.*between|divergence|previous version|current version/i, weight: 2 },
    { regex: /\bvs\b|versus/i, weight: 2 },
    { regex: /entre.*(document|version|source|fichier)|between.*(document|version|source|file)/i, weight: 1.5 },
    { regex: /réconcili|fusionner.*version|merge.*document|reconcile|merge.*version|compare sources/i, weight: 2 },
    { regex: /écart(s)?.*entre|delta\b|gap(s)?.*between/i, weight: 1.5 },
  ],

  root_cause_analysis: [
    // Anciennement dupliqué avec une seconde entrée `/root cause/i` de même
    // poids : toute requête contenant "root cause" recevait +5 au lieu de
    // +2.5, biaisant le score par rapport aux autres stratégies qui n'ont
    // qu'une seule entrée par motif.
    { regex: /cause (racine|profonde|première)|root cause|underlying cause/i, weight: 2.5 },
    { regex: /5 pourquoi|5 whys|five whys|why does.*happen/i, weight: 2.5 },
    { regex: /pourquoi.*(arrive|se produit|survient|persiste|revient)|why.*(happen|occur|persist|recur)/i, weight: 2 },
    { regex: /diagnostiquer|diagnostic.*(panne|incident|défaillance)|diagnos(e|is)|troubleshoot/i, weight: 2 },
    { regex: /origine du problème|à l'origine de|problem origin|source of the problem/i, weight: 1.5 },
    { regex: /panne récurrente|bug récurrent|incident récurrent|dysfonctionnement|recurring (failure|bug|incident)|system failure/i, weight: 1.5 },
  ],

  document_analysis: [
    { regex: /résum(é|er)|synth(è|é)s(e|er)|condenser|point(s)?.?clé(s)?|idée(s)?.?clé(s)?|summar(y|ize|ise)|key point(s)?|executive summary/i, weight: 1.5 },
    { regex: /extraire|extraction|identifier.*information|repérer.*dans|inventorier|extract|extraction|identify.*information|list.*from/i, weight: 1.5 },
    { regex: /relire|relecture|proofreading|réviser.*document|corriger.*texte|proofread|review.*document|edit.*text/i, weight: 1.5 },
    { regex: /conformit(é)?|audit|norme|iso\s?\d|check.?list|réglementaire|compliance|regulatory|standard/i, weight: 1.5 },
    { regex: /annoter|annotation|marge|feedback.*document|annotate|margin note|document feedback/i, weight: 1.5 },
    { regex: /classif|catégoris|trier.*document|ranger|taxon|étiqueter|classif(y|ication)|categorize|sort.*document|tag/i, weight: 1.5 },
    { regex: /analyser.*document|analyse.*contenu|examen.*texte|diagnostic.*document|analy[sz]e.*document|content analysis|examine.*text/i, weight: 2 },
    { regex: /table des matières|sommaire.*générer|index.*document/i, weight: 1.5 },
    { regex: /cohérence.*document|qualité.*rédaction|lisibilité/i, weight: 1.5 },
    { regex: /fiche.*lecture|note.*synthèse|abstract|executive.?summary/i, weight: 1.5 },
  ],

  decomposition: [
    { regex: /complexe|complex/i, weight: 1 },
    { regex: /dossier|case file/i, weight: 1 },
    { regex: /rapport|report/i, weight: 0.75 },
    { regex: /plusieurs parties|multiple parts|several sections/i, weight: 1.5 },
    { regex: /multi-étapes|multi[- ]step/i, weight: 1.5 },
    { regex: /structurer|structure/i, weight: 1 },
    { regex: /organiser|organize|reorganize/i, weight: 1 },
    { regex: /plan\b(?!.*d'action.*simple)/i, weight: 1 },
    { regex: /restructur|réorganis|refonte/i, weight: 1.5 },
  ],

  analogical: [
    { regex: /comme|similaire|analogie|comparable|ressemble|similar|analogy|comparable|resembles/i, weight: 1 },
    { regex: /modèle de document|template|s'inspirer de|à la manière de|inspired by|like a|document model/i, weight: 1.5 },
  ],

  first_principles: [
    { regex: /fondamental|principes|repenser|fundamental|principles|rethink/i, weight: 1 },
    { regex: /depuis zéro|from scratch|repartir de la base|start from the ground up/i, weight: 1.5 },
    // "pourquoi" seul est un signal faible ici : les formulations fortes de
    // recherche de cause (bug, panne, incident...) sont captées avec un poids
    // bien plus élevé par root_cause_analysis, qui l'emportera dans ces cas.
    { regex: /\bpourquoi\b/i, weight: 0.5 },
  ],

  self_critique: [
    { regex: /vérifier|critiquer|robuste|fiable|verify|criticize|robust|reliable/i, weight: 1 },
    { regex: /cas limite|valider|contre-vérifier|double check|edge case|validate|cross-check/i, weight: 1 },
    { regex: /\brelire\b/i, weight: 0.5 },
  ],

  tree_of_thought: [
    { regex: /enjeu (majeur|critique|stratégique)|major|critical|strategic stake/i, weight: 2 },
    { regex: /décision (stratégique|irréversible)|strategic|irreversible decision/i, weight: 2 },
    { regex: /irréversible|à fort enjeu|risque élevé|high[- ]stakes|high risk|irreversible/i, weight: 1.5 },
  ],

  chain_of_thought: [
    { regex: /étape par étape|pas à pas|step by step|walk me through/i, weight: 1.5 },
  ],
};

function autoSelectStrategy(prompt: string): Exclude<ThinkingStrategy, "auto"> {
  const lower = (prompt ?? "").toLowerCase();

  // La complexité "critical" force toujours l'exploration multi-branches,
  // indépendamment du score textuel (garde-fou prioritaire).
  const complexity = assessComplexity(prompt);
  if (complexity === "critical") return "tree_of_thought";

  const scores: Partial<Record<Exclude<ThinkingStrategy, "auto">, number>> = {};

  for (const [strategyId, patterns] of Object.entries(STRATEGY_PATTERNS) as [
    Exclude<ThinkingStrategy, "auto">,
    StrategyPattern[]
  ][]) {
    let score = 0;
    for (const { regex, weight } of patterns) {
      if (regex.test(lower)) score += weight;
    }
    if (score > 0) scores[strategyId] = score;
  }

  // Légers ajustements liés au niveau de complexité global détecté.
  if (complexity === "complex") {
    scores.decomposition = (scores.decomposition ?? 0) + 1.5;
  } else if (complexity === "moderate") {
    scores.chain_of_thought = (scores.chain_of_thought ?? 0) + 0.5;
  }

  let bestStrategy: Exclude<ThinkingStrategy, "auto"> = "chain_of_thought";
  let bestScore = 0;
  for (const [strategyId, score] of Object.entries(scores) as [Exclude<ThinkingStrategy, "auto">, number][]) {
    if (score > bestScore) {
      bestScore = score;
      bestStrategy = strategyId;
    }
  }

  return bestScore >= MIN_SCORE_THRESHOLD ? bestStrategy : "chain_of_thought";
}

// ─── Build the thinking prompt ──────────────────────────────────────────────

function buildThinkingPrompt(strategy: Exclude<ThinkingStrategy, "auto">, userPrompt: string): string {
  const config = THINKING_STRATEGIES[strategy];
  return `${config.systemPrompt}\n\n## Niveau de confiance\nIndique explicitement un niveau de confiance (élevé, moyen ou faible) et justifie-le en une phrase.\n\n---\n\nPROBLÈME À RÉSOUDRE :\n${userPrompt}`;
}

// ─── Skill Export ───────────────────────────────────────────────────────────

export const reasoningSkill: Skill = {
  name: "reasoning",
  declarations: [
    {
      name: "reasoning_think",
      description:
        "Effectue un raisonnement structuré selon la stratégie choisie (auto, chain_of_thought, decomposition, document_analysis, comparative_analysis, root_cause_analysis, self_critique, tree_of_thought…). " +
        "Retourne un plan d'action. **Ne jamais s'arrêter après cet outil** — exécute immédiatement le plan ou formule la réponse finale. " +
        "Utiliser uniquement si : ≥ 3 étapes logiques, document sensible/confidentiel, approche ayant échoué (self_critique), analyse/synthèse/comparaison de documents (document_analysis, comparative_analysis), diagnostic d'un incident/bug/panne récurrente (root_cause_analysis), ou production d'un document/dossier majeur (tree_of_thought).",
      parameters: {
        type: "OBJECT",
        properties: {
          prompt: {
            type: "STRING",
            description: "Le problème ou la question à résoudre avec un raisonnement structuré.",
          },
          strategy: {
            type: "STRING",
            description:
              "La stratégie de pensée à utiliser : 'chain_of_thought', 'decomposition', 'analogical', 'self_critique', 'first_principles', 'tree_of_thought', 'document_analysis', 'comparative_analysis', 'root_cause_analysis', ou 'auto' pour laisser Leanna choisir. Défaut: 'auto'. Utilisez 'document_analysis' pour synthèse/extraction/relecture de documents, 'comparative_analysis' pour croiser des sources, 'root_cause_analysis' pour remonter du symptôme à la cause profonde d'un incident/bug/panne, 'tree_of_thought' pour les tâches critiques.",
          },
        },
        required: ["prompt"],
      },
    },
    {
      name: "agent_execute",
      description:
        "Exécution interne réservée aux agents : produit directement un résultat concret, des appels structurés autorisés ou du contenu de document à produire/modifier. Ne génère pas de plan de raisonnement.",
      parameters: {
        type: "OBJECT",
        properties: {
          prompt: { type: "STRING", description: "Contexte, objectif et contrat d'exécution de l'agent." },
        },
        required: ["prompt"],
      },
    },
    {
      name: "reasoning_delegate_task",
      description:
        "Délègue une tâche longue ou complexe en arrière-plan. L'orchestrateur s'en chargera et vous préviendra quand ce sera terminé.",
      parameters: {
        type: "OBJECT",
        properties: {
          task_type: {
            type: "STRING",
            description:
              "Le type de tâche: 'logic_analysis' (réflexion longue avec Gemini 2.5 Pro) ou 'execute_command' (lancer un script long)",
          },
          payload: {
            type: "STRING",
            description: "Le prompt pour 'logic_analysis' ou la commande shell pour 'execute_command'",
          },
        },
        required: ["task_type", "payload"],
      },
    },
    {
      name: "reasoning_list_strategies",
      description: "Liste toutes les stratégies de pensée disponibles avec leur description.",
      parameters: {
        type: "OBJECT",
        properties: {},
        required: [],
      },
    },
  ],

  handleToolCall: async (name, args, context) => {
    // ── agent_execute : voie d'exécution sans le wrapper de planification ──
    if (name === "agent_execute") {
      const prompt = typeof args?.prompt === "string" ? args.prompt.trim() : "";
      if (!prompt) return { error: "Prompt d'exécution agent requis." };

      const systemPrompt =
        "Tu es un agent d'exécution documentaire. Travaille uniquement sur le contexte fourni. " +
        "Ne fournis pas de plan, ne demande pas d'archive et ne simule jamais un traitement. " +
        "Produis soit des appels structurés autorisés (JSON tool_calls avec name et parameters), soit un résultat final concret avec preuves et le contenu complet des documents à produire ou modifier. " +
        "Réponds toujours avec du texte visible; ne reste jamais silencieux.";

      // Utilise le provider actif (Gemini ou OpenRouter selon le profil utilisateur)
      // avec thinkingBudget: 0 pour forcer une sortie visible immédiate.
      try {
        const response = await generateText({
          prompt,
          systemPrompt,
          temperature: 0.3,
          thinkingBudget: 0,
          maxOutputTokens: 16_384,
        });
        const answer = response.text.trim();
        if (answer) {
          return {
            answer,
            metadata: { model: response.model, provider: response.provider, mode: "agent_execute" },
          };
        }
        console.warn(`[agent_execute] ${response.provider}/${response.model} n'a produit aucun texte, tentative avec fallback...`);
      } catch (error) {
        console.warn(`[agent_execute] Erreur provider actif: ${(error as Error).message}, tentative avec fallback...`);
      }

      // Fallback : tente l'autre provider (si Gemini actif → OpenRouter, et vice versa)
      try {
        const activeProvider = getActiveProvider();
        const fallbackOptions: any = {
          prompt: `${systemPrompt}\n\n${prompt}`,
          temperature: 0.3,
          thinkingBudget: 0,
          maxOutputTokens: 16_384,
        };
        // Force l'autre provider comme fallback
        if (activeProvider === 'gemini') {
          fallbackOptions.openrouterModel = 'google/gemini-3.6-flash';
        } else {
          fallbackOptions.geminiModel = 'gemini-2.5-flash';
        }

        const fallback = await generateText(fallbackOptions);
        const answer = fallback.text.trim();
        if (answer) {
          return {
            answer,
            metadata: { model: fallback.model, provider: fallback.provider, mode: "agent_execute_fallback" },
          };
        }
      } catch (error) {
        return { error: `Erreur d'exécution agent (fallback): ${(error as Error).message}` };
      }

      return { error: "Le modèle n'a produit aucune sortie exécutable après 2 tentatives." };
    }

    // ── reasoning_think ─────────────────────────────────────────────────
    if (name === "reasoning_think") {
      const { prompt, strategy: requestedStrategy } = args;

      // Guard: prompt est requis — retourne une erreur structurée plutôt que de crasher
      if (!prompt || typeof prompt !== "string") {
        return { error: "Le paramètre 'prompt' est requis pour reasoning_think." };
      }

      const chosenStrategy: Exclude<ThinkingStrategy, "auto"> =
        !requestedStrategy || requestedStrategy === "auto"
          ? autoSelectStrategy(prompt)
          : (requestedStrategy as Exclude<ThinkingStrategy, "auto">);

      const config = THINKING_STRATEGIES[chosenStrategy];
      if (!config) {
        return { error: `Stratégie inconnue: '${requestedStrategy}'. Utilisez reasoning_list_strategies pour voir les options.` };
      }

      // ── Étape de pré-raisonnement : CoT automatique pour complexe/critique ──
      // Pour les stratégies qui bénéficient d'une décomposition préalable,
      // on exécute le ChainOfThoughtExecutor avant d'appeler le LLM principal.
      //
      // IMPORTANT : "chain_of_thought" et "tree_of_thought" sont volontairement
      // EXCLUS de cette liste. Ces deux stratégies effectuent déjà elles-mêmes
      // une décomposition/exploration complète via leur propre systemPrompt
      // (et, pour tree_of_thought, via runTreeOfThought ci-dessous qui explore
      // 3 branches + une évaluation). Les inclure ici doublait le travail :
      // un "critical" déclenchait jusqu'à 5 appels LLM (1 pré-CoT + 3 branches
      // + 1 évaluation) pour un seul reasoning_think. Ne garder le pré-CoT que
      // pour les stratégies qui n'explorent pas déjà nativement plusieurs
      // pistes de raisonnement.
      const isDecompositionStrategy =
        chosenStrategy === "decomposition" ||
        chosenStrategy === "document_analysis" ||
        chosenStrategy === "comparative_analysis" ||
        chosenStrategy === "root_cause_analysis";

      const complexity = assessComplexity(prompt);
      const shouldRunCoT = isDecompositionStrategy && complexity !== "simple";

      // ── Annonce du raisonnement (texte + TTS) ──────────────────────────────
      // IMPORTANT : on signale TOUJOURS à l'utilisateur (par le texte) que le
      // raisonnement démarre, AVANT de lancer quoi que ce soit (CoT ou LLM
      // principal). La voix (TTS), elle, est volontairement plus sélective :
      // - jamais pour une complexité "simple" (pas besoin de prévenir pour peu)
      // - texte tronqué pour rester lisible dans l'interface
      const reasonLabel = config.label;
      const complexityLabels: Record<string, string> = {
        simple: "simple",
        moderate: "modérée",
        complex: "complexe",
        critical: "critique",
      };
      const complexityText = complexityLabels[complexity] || complexity;
      const reasonExplanation = buildReasoningExplanation(prompt, chosenStrategy, complexity);
      let announcementText = `Raisonnement ${reasonLabel}, la tâche est ${complexityText}. ${reasonExplanation}`;
      if (announcementText.length > ANNOUNCEMENT_MAX_CHARS) {
        announcementText = announcementText.slice(0, ANNOUNCEMENT_MAX_CHARS - 1).trimEnd() + "…";
      }

      // 1. Émettre l'état reasoning + texte d'annonce au frontend IMMÉDIATEMENT
      //    (toujours, indépendamment de la voix)
      if (context?.emitToClient) {
        context.emitToClient({
          reasoning: {
            active: true,
            strategy: chosenStrategy,
            strategyLabel: config.label,
            complexity,
            announcement: announcementText,
          },
        });
      }

      let cotContext = "";
      let cotDecomposition: string[] = [];

      if (shouldRunCoT) {
        try {
          const cotExecutor = new ChainOfThoughtExecutor({
            emitToClient: context?.emitToClient,
          });
          const cotResult = await cotExecutor.run(prompt, complexity);

          if (cotResult.decomposition.length > 0) {
            cotDecomposition = cotResult.decomposition;
            cotContext = [
              `## Décomposition préalable (Chain of Thought)`,
              `Complexité détectée : ${cotResult.complexity}`,
              `Stratégie : ${cotResult.strategy}`,
              ``,
              `Sous-tâches identifiées :`,
              ...cotResult.decomposition.map((s, i) => `${i + 1}. ${s}`),
              ...(cotResult.answer
                ? [``, `Analyse préliminaire :`, cotResult.answer.slice(0, 800)]
                : []),
              ``,
              `---`,
              ``,
            ].join("\n");
          }
        } catch (cotErr) {
          // Le CoT est en best-effort, on continue sans lui
          console.warn(`[ReasoningSkill] CoT pre-processing failed: ${(cotErr as Error).message}`);
        }
      } else {
        // Pas de CoT nécessaire — le reasoning active a déjà été émis plus haut
      }

      // Enrichir le prompt avec le contexte CoT si disponible
      const enrichedPrompt = cotContext
        ? `${cotContext}${prompt}`
        : prompt;

      const fullPrompt = buildThinkingPrompt(chosenStrategy, enrichedPrompt);

      try {
        const budget = reasoningBudget(complexity);
        const cacheKey = reasoningCacheKey(chosenStrategy, prompt);
        const cached = reasoningCache.get(cacheKey);
        let response: GenerateTextResult;
        let treeEvaluation: string | undefined;
        let treeWinner: number | undefined;
        let confidenceReview = false;

        if (cached && cached.expiresAt > Date.now()) {
          response = cached.result;
          context?.emitToClient?.({ reasoning: { chunk: response.text, cached: true } });
        } else {
          if (cached) reasoningCache.delete(cacheKey);

          if (chosenStrategy === "tree_of_thought") {
            const treeResult = await runTreeOfThought(enrichedPrompt, budget);
            response = treeResult;
            treeEvaluation = treeResult.evaluation;
            treeWinner = treeResult.winner;
          } else {
            const shouldStream = chosenStrategy === "document_analysis" || chosenStrategy === "comparative_analysis";
            if (shouldStream) {
              try {
                let streamedText = "";
                streamedText = await generateTextStream({
                  prompt: fullPrompt,
                  systemPrompt: config.systemPrompt,
                  temperature: 0.3,
                  ...budget,
                  onChunk: (chunk) => context?.emitToClient?.({ reasoning: { chunk } }),
                });
                response = {
                  text: streamedText,
                  provider: getActiveProvider(),
                  model: getActiveProvider() === "gemini" ? "gemini-2.5-flash" : "openrouter",
                };
              } catch {
                response = await generateText({
                  prompt: fullPrompt,
                  systemPrompt: config.systemPrompt,
                  temperature: 0.3,
                  ...budget,
                });
              }
            } else {
              response = await generateText({
                prompt: fullPrompt,
                systemPrompt: config.systemPrompt,
                temperature: 0.3,
                ...budget,
              });
            }

            if (chosenStrategy === "self_critique") {
              response = await runSelfCritique(enrichedPrompt, response, budget);
            }
          }

          // Une confiance faible sur une tâche complexe justifie une vraie seconde passe.
          const confidence = extractConfidence(response.text);
          if (chosenStrategy !== "self_critique" && (confidence === "low" || confidence === "medium") && (complexity === "complex" || complexity === "critical")) {
            confidenceReview = true;
            response = await runSelfCritique(enrichedPrompt, response, budget);
          }

          reasoningCache.set(cacheKey, { expiresAt: Date.now() + REASONING_CACHE_TTL_MS, result: response });
          if (reasoningCache.size > 50) {
            const oldestKey = reasoningCache.keys().next().value;
            if (oldestKey) reasoningCache.delete(oldestKey);
          }
        }

        // Notify frontend that reasoning is done
        if (context?.emitToClient) {
          context.emitToClient({ reasoning: { active: false } });
        }

        return {
          strategy_used: config.label,
          strategy_id: chosenStrategy,
          complexity_detected: complexity,
          decomposition: cotDecomposition.length > 0 ? cotDecomposition : undefined,
          reasoning: response.text,
          next_action: "Le raisonnement est terminé. Tu DOIS maintenant utiliser ce plan pour agir : exécute les étapes identifiées, ou si c'était une question, formule la réponse finale à l'utilisateur en te basant sur la section 'Conclusion' ou 'Approche retenue' ci-dessus.",
          metadata: {
            auto_selected: !requestedStrategy || requestedStrategy === "auto",
            cot_preprocessing: shouldRunCoT && cotDecomposition.length > 0,
            cache_hit: Boolean(cached && cached.expiresAt > Date.now()),
            confidence_review: confidenceReview,
            ...(treeWinner ? { tree_winner: treeWinner, tree_evaluation: treeEvaluation } : {}),
            model: response.model,
            provider: response.provider,
          },
        };
      } catch (e: any) {
        // Notify frontend that reasoning ended (with error)
        if (context && context.emitToClient) {
          context.emitToClient({ reasoning: { active: false } });
        }
        return { error: `Erreur lors du raisonnement: ${e.message}` };
      }
    }

    // ── reasoning_list_strategies ───────────────────────────────────────
    if (name === "reasoning_list_strategies") {
      const strategies = Object.entries(THINKING_STRATEGIES).map(([id, config]) => ({
        id,
        label: config.label,
        description: config.description,
      }));
      return {
        strategies,
        auto_selection_info: {
          description: "Le mode 'auto' calcule un score pondéré par stratégie à partir de motifs textuels (STRATEGY_PATTERNS), puis retient le score le plus élevé (seuil minimum : MIN_SCORE_THRESHOLD). La complexité 'critical' (assessComplexity()) force toujours tree_of_thought, indépendamment du score textuel.",
          levels: {
            simple: "Réponse directe, pas de décomposition, pas d'annonce vocale",
            moderate: "Score textuel + léger bonus pour chain_of_thought",
            complex: "Score textuel + bonus pour decomposition",
            critical: "tree_of_thought forcé — exploration de 3 branches avant décision",
          },
        },
        note: "Utilisez reasoning_think avec le paramètre 'strategy' pour choisir, ou laissez 'auto' pour une sélection automatique basée sur les motifs détectés et la complexité.",
      };
    }

    // ── reasoning_delegate_task ─────────────────────────────────────────
    if (name === "reasoning_delegate_task") {
      const { task_type, payload } = args;

      // Lance la tâche en arrière-plan sans await
      (async () => {
        try {
          if (task_type === "logic_analysis") {
            console.log(`[Reasoning] Démarrage de l'analyse logique en arrière-plan...`);

            // Utilise Chain of Thought par défaut pour les analyses déléguées
            const thinkingPrompt = buildThinkingPrompt("chain_of_thought", payload);

            const response = await generateText({
              prompt: thinkingPrompt,
              systemPrompt: THINKING_STRATEGIES.chain_of_thought.systemPrompt,
              temperature: 0.3,
            });
            if (context && context.notifyLiveAPI) {
              context.notifyLiveAPI(
                `L'analyse logique (Chain of Thought) est terminée. Voici le résultat :\n${response.text}`
              );
            }
          } else if (task_type === "execute_command") {
            const targetArg = parseReasoningListCommand(payload);
            if (targetArg === null) {
              if (context && context.notifyLiveAPI) {
                context.notifyLiveAPI(
                  `Commande refusée: seules les commandes 'dir' ou 'ls' sont autorisées dans le workspace du projet.`
                );
              }
              return;
            }

            let resolvedPath = getProjectRoot();
            if (targetArg) {
              const normalized = normalizeProjectPath(targetArg);
              if (!normalized) {
                if (context && context.notifyLiveAPI) {
                  context.notifyLiveAPI(
                    `Commande refusée: le chemin doit rester à l'intérieur du workspace du projet.`
                  );
                }
                return;
              }
              resolvedPath = normalized;
            }

            // A directory listing does not need a shell or child process. Using
            // the filesystem API keeps untrusted paths as data, never commands.
            console.log(`[Reasoning] Listing workspace directory: ${resolvedPath}`);
            try {
              const entries = await fs.promises.readdir(resolvedPath, { withFileTypes: true });
              const output = entries
                .slice(0, 500)
                .map((entry) => `${entry.isDirectory() ? "[DIR] " : "      "}${entry.name}`)
                .join("\n");
              const truncated = entries.length > 500 ? "\n… liste tronquée à 500 éléments" : "";
              context?.notifyLiveAPI?.(
                `La tâche '${payload}' est terminée avec succès.\nStdout: ${(output + truncated).substring(0, 500)}`
              );
            } catch (error) {
              context?.notifyLiveAPI?.(
                `La tâche '${payload}' s'est terminée avec une erreur: ${(error as Error).message}`
              );
            }
          }
        } catch (e: any) {
          console.error("[Reasoning] Erreur en arrière-plan:", e);
          if (context && context.notifyLiveAPI) {
            context.notifyLiveAPI(`Erreur lors de la tâche d'arrière-plan: ${e.message}`);
          }
        }
      })();

      return {
        status:
          "Tâche déléguée avec succès en arrière-plan. Vous pouvez informer l'utilisateur que vous vous en occupez. Vous recevrez un message système avec le résultat quand ce sera terminé.",
      };
    }

    return { error: "Unknown tool" };
  },
};