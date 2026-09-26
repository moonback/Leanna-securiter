/**
 * Token Optimizer — Gestion intelligente du contexte pour réduire la consommation de tokens.
 * 
 * Stratégies :
 * 1. Estimation du nombre de tokens (heuristique rapide)
 * 2. Trimming du contexte mémoire selon la pertinence
 * 3. Résumé automatique des vieux messages (LLM ou fallback local)
 * 4. Compression du system prompt (mode compact via ProfileConfig.compactPrompt)
 */

// ─── Estimation rapide des tokens ────────────────────────────────────────────

type TiktokenLike = { encode(text: string): ArrayLike<number> };
let _tiktokenEncoding: TiktokenLike | null | undefined = undefined;
let _tiktokenLoadAttempted = false;
let _tiktokenLoadPromise: Promise<TiktokenLike | null> | null = null;
const LOG_PREFIX = '[TokenOptimizer]';

/** Charge tiktoken de manière asynchrone */
async function loadTiktokenAsync(): Promise<TiktokenLike | null> {
  if (_tiktokenLoadPromise) {
    return _tiktokenLoadPromise;
  }
  
  _tiktokenLoadPromise = (async () => {
    if (_tiktokenLoadAttempted) {
      return _tiktokenEncoding ?? null;
    }
    _tiktokenLoadAttempted = true;
    
    try {
      // Import dynamique - fonctionne en ESM et CommonJS (Node.js gère l'interop)
      const mod = await import('tiktoken');
      const enc: TiktokenLike | null =
        (typeof (mod as any).encodingForModel === "function" && (mod as any).encodingForModel("gpt-4o")) ||
        (typeof (mod as any).getEncoding === "function" && (mod as any).getEncoding("cl100k_base")) ||
        null;
      
      if (enc && typeof enc.encode === "function") {
        _tiktokenEncoding = enc;
        console.log(LOG_PREFIX + " ✅ tiktoken chargé (cl100k_base) — estimations précises.");
        return enc;
      }
    } catch {
      // tiktoken non disponible — ignorer
    }
    return null;
  })();
  
  return _tiktokenLoadPromise;
}

/** Charge tiktoken de manière synchrone (pour compatibilité) */
function tryLoadTiktokenSync(): TiktokenLike | null {
  if (_tiktokenLoadAttempted) {
    return _tiktokenEncoding ?? null;
  }
  _tiktokenLoadAttempted = true;
  
  try {
    // Essayer require pour les environnements CommonJS
    // Note: En ESM pur, require n'existe pas, donc on saute
    if (typeof require !== 'undefined') {
      const mod = require('tiktoken');
      const enc: TiktokenLike | null =
        (typeof (mod as any).encodingForModel === "function" && (mod as any).encodingForModel("gpt-4o")) ||
        (typeof (mod as any).getEncoding === "function" && (mod as any).getEncoding("cl100k_base")) ||
        null;
      
      if (enc && typeof enc.encode === "function") {
        _tiktokenEncoding = enc;
        console.log(LOG_PREFIX + " ✅ tiktoken chargé (cl100k_base) — estimations précises.");
        return enc;
      }
    }
  } catch {
    // tiktoken non disponible
  }
  return null;
}

/**
 * Charge tiktoken — essaie d'abord la version synchrone, puis asynchrone si nécessaire
 */
function loadTiktoken(): TiktokenLike | null {
  return tryLoadTiktokenSync();
}

/**
 * Estimation du nombre de tokens pour un texte.
 * Priorité :
 *   1. tiktoken cl100k_base (si installé) — précis sur code et texte mixte.
 *   2. fallback heuristique adaptatif — selon la densité de ponctuation/caractères
 *      de code (augmente le ratio en tokens pour les lignes denses en symboles).
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const enc = loadTiktoken();
  if (enc) {
    try {
      const ids = enc.encode(text);
      return typeof ids.length === "number" ? ids.length : Array.from(ids).length;
    } catch {
      /* fallthrough */
    }
  }

  // Heuristique adaptative : différencier segments de "code" / "commentaires".
  // Un caractère ASCII de ponctuation / opérateur fréquent indique plus de tokens.
  const lines = text.split(/\r?\n/);
  let total = 0;
  for (const line of lines) {
    if (!line) { total += 0; continue; }
    const len = line.length;
    const ws = (line.match(/\s/g) || []).length;
    const codeSymbols = (line.match(/[{}()[\]<>,;:=+\-*/&|!?~`%^@#$'"\\]/g) || []).length;
    const words = line.trim().split(/\s+/).filter(Boolean).length;
    const codeRatio = len === 0 ? 0 : Math.min(1, codeSymbols / Math.max(1, len - ws));
    // Pour une ligne dense en symboles (~code), ~3 chars/token ; sinon ~4 chars/token.
    const charsPerToken = 4.0 - codeRatio * 1.0; // 4 → 3 selon densité
    const byChars = len / charsPerToken;
    const byWords = words * 1.3;
    total += Math.max(1, Math.ceil((byChars + byWords) / 2));
  }
  return Math.max(1, total);
}

// ─── Logging ─────────────────────────────────────────────────────────────────

function logInfo(msg: string, data?: Record<string, any>) {
  const extra = data ? ' ' + JSON.stringify(data) : '';
  console.log(`${LOG_PREFIX} ${msg}${extra}`);
}

function logWarn(msg: string, data?: Record<string, any>) {
  const extra = data ? ' ' + JSON.stringify(data) : '';
  console.warn(`${LOG_PREFIX} ⚠️  ${msg}${extra}`);
}

function logSuccess(msg: string, data?: Record<string, any>) {
  const extra = data ? ' ' + JSON.stringify(data) : '';
  console.log(`${LOG_PREFIX} ✅ ${msg}${extra}`);
}

// ─── Configuration des limites ───────────────────────────────────────────────

export interface TokenBudget {
  maxTotal: number;
  systemPrompt: number;
  memory: number;
  conversationHistory: number;
  responseReserve: number;
}

export const DEFAULT_BUDGET_GEMINI: TokenBudget = {
  maxTotal: 128_000,
  systemPrompt: 5_000,
  memory: 2_000,
  conversationHistory: 100_000,
  responseReserve: 16_000,
};

export const MODEL_BUDGETS: Record<string, TokenBudget> = {
  'default': {
    maxTotal: 128_000,
    systemPrompt: 5_000,
    memory: 2_000,
    conversationHistory: 100_000,
    responseReserve: 16_000,
  },
  'openai/gpt-4o': {
    maxTotal: 128_000,
    systemPrompt: 5_000,
    memory: 2_000,
    conversationHistory: 100_000,
    responseReserve: 16_000,
  },
  'openai/gpt-4o-mini': {
    maxTotal: 128_000,
    systemPrompt: 4_000,
    memory: 1_500,
    conversationHistory: 105_000,
    responseReserve: 16_000,
  },
  'anthropic/claude-sonnet-4': {
    maxTotal: 200_000,
    systemPrompt: 5_000,
    memory: 3_000,
    conversationHistory: 170_000,
    responseReserve: 16_000,
  },
  'anthropic/claude-3.5-sonnet': {
    maxTotal: 200_000,
    systemPrompt: 5_000,
    memory: 3_000,
    conversationHistory: 170_000,
    responseReserve: 16_000,
  },
  'google/gemini-3.6-flash': {
    maxTotal: 1_000_000,
    systemPrompt: 5_000,
    memory: 3_000,
    conversationHistory: 900_000,
    responseReserve: 65_000,
  },
  'google/gemini-2.5-pro-preview-05-06': {
    maxTotal: 1_000_000,
    systemPrompt: 5_000,
    memory: 3_000,
    conversationHistory: 900_000,
    responseReserve: 65_000,
  },
};

export function getBudgetForModel(model: string): TokenBudget {
  return MODEL_BUDGETS[model] ?? MODEL_BUDGETS['default'];
}

// ─── Optimisation du contexte mémoire ────────────────────────────────────────

export interface MemoryItem {
  content: string;
  created_at?: string;
  relevance?: number;
  category?: string; // Catégorie de la mémoire (stack, architecture, convention, decision, etc.)
}

// Catégories critiques qui doivent être préservées même si longues
const CRITICAL_CATEGORIES = new Set(['architecture', 'decision', 'convention', 'security']);

// Score minimum pour les catégories critiques - même avec une longueur élevée
const CRITICAL_CATEGORY_MIN_SCORE = 50;

/**
 * Calcul le score d'une mémoire avec pondération améliorée
 */
function calculateMemoryScore(
  memory: MemoryItem,
  index: number,
  totalMemories: number
): number {
  const lengthTokens = estimateTokens(memory.content);
  
  // 1. Récence (plus récent = plus important)
  const recencyScore = (totalMemories - index) * 3;
  
  // 2. Pertinence explicite
  const relevanceBonus = (memory.relevance ?? 1) * 15;
  
  // 3. Pénalisation de longueur - plus douce pour éviter d'éliminer les mémoires longues importantes
  // Utiliser un facteur logarithmique plutôt que linéaire
  const lengthPenalty = lengthTokens > 200 
    ? Math.log10(lengthTokens) * 3 
    : (lengthTokens > 100 ? Math.log10(lengthTokens) * 2 : 0);
  
  // 4. Bonus pour les catégories critiques
  const categoryBonus = memory.category && CRITICAL_CATEGORIES.has(memory.category) 
    ? 25 + (lengthTokens / 10) // Bonus proportionnel à la longueur pour les catégories critiques
    : 0;
  
  // 5. Bonus pour les mémoires moyennes (100-500 tokens) - meilleur ratio info/tokens
  const mediumSizeBonus = lengthTokens >= 100 && lengthTokens <= 500 ? 10 : 0;

  const score = recencyScore + relevanceBonus - lengthPenalty + mediumSizeBonus + categoryBonus;
  
  // Score minimum pour les catégories critiques
  if (memory.category && CRITICAL_CATEGORIES.has(memory.category)) {
    return Math.max(score, CRITICAL_CATEGORY_MIN_SCORE);
  }
  
  return score;
}

/**
 * Optimise les mémoires avec un système de scoring amélioré
 * 
 * Améliorations vs version précédente :
 * 1. Budget proportionnel au contexte total du modèle (via getProportionalMemoryBudget)
 * 2. Score minimum pour les catégories critiques (architecture, decision, etc.)
 * 3. Pénalisation de longueur plus douce (logarithmique)
 * 4. Bonus pour les mémoires de taille moyenne (meilleur ratio info/tokens)
 * 5. Meilleure pondération de la pertinence
 */
export function optimizeMemories(
  memories: MemoryItem[], 
  budgetTokens: number,
  options: { model?: string; totalContextTokens?: number } = {}
): MemoryItem[] {
  if (!memories.length) {
    logInfo('optimizeMemories: aucune mémoire à optimiser');
    return [];
  }

  // Calculer un budget proportionnel si le contexte total est fourni
  const effectiveBudget = getProportionalMemoryBudget(budgetTokens, options);

  // Trier par score (meilleures mémoires en premier)
  const scored = memories.map((m, i) => ({
    ...m,
    score: calculateMemoryScore(m, i, memories.length),
  }));

  scored.sort((a, b) => b.score - a.score);

  const result: MemoryItem[] = [];
  const skipped: MemoryItem[] = [];
  let usedTokens = 0;

  // Première passe : essayer de garder toutes les mémoires
  for (const memory of scored) {
    const tokens = estimateTokens(memory.content);
    if (usedTokens + tokens <= effectiveBudget) {
      result.push(memory);
      usedTokens += tokens;
    } else {
      skipped.push(memory);
    }
  }

  // Si on a dépassé le budget, essayer d'ajouter les mémoires critiques qui n'ont pas passé
  if (skipped.length > 0 && result.length < scored.length) {
    const criticalSkipped = skipped.filter(m => 
      m.category && CRITICAL_CATEGORIES.has(m.category)
    );
    
    for (const criticalMemory of criticalSkipped) {
      const tokens = estimateTokens(criticalMemory.content);
      if (usedTokens + tokens <= effectiveBudget) {
        result.push(criticalMemory);
        usedTokens += tokens;
        // Retirer de skipped
        const idx = skipped.indexOf(criticalMemory);
        if (idx > -1) skipped.splice(idx, 1);
      }
    }
  }

  logSuccess('optimizeMemories: terminé', {
    kept: result.length,
    dropped: skipped.length,
    tokensUsed: usedTokens,
    budgetTokens: effectiveBudget,
    criticalPreserved: result.filter(m => m.category && CRITICAL_CATEGORIES.has(m.category)).length,
  });

  return result;
}

/**
 * Calcul un budget mémoire proportionnel au contexte total du modèle
 * 
 * Au lieu d'un budget fixe de 2-3k tokens, on utilise une proportion du contexte total.
 * Par défaut : 10% du contexte total, avec un minimum de 2k et un maximum de 10k tokens.
 */
function getProportionalMemoryBudget(
  baseBudget: number,
  options: { model?: string; totalContextTokens?: number }
): number {
  const { model, totalContextTokens } = options;
  
  // Si on a le contexte total, calculer un budget proportionnel
  if (totalContextTokens) {
    // Utiliser 10-15% du contexte total pour la mémoire
    const proportion = model?.includes('gemini') || model?.includes('claude') ? 0.15 : 0.10;
    const proportionalBudget = Math.floor(totalContextTokens * proportion);
    
    // Appliquer des limites raisonnables
    const minBudget = baseBudget; // 2k-3k selon le modèle
    const maxBudget = Math.min(10_000, totalContextTokens * 0.2); // Max 10k ou 20% du contexte
    
    return Math.max(minBudget, Math.min(proportionalBudget, maxBudget));
  }
  
  // Sinon, retourner le budget de base
  return baseBudget;
}

/**
 * Récupère le budget mémoire recommandé pour un modèle donné
 * utile pour afficher dans les logs ou pour les tests
 */
export function getRecommendedMemoryBudget(model: string, totalContextTokens?: number): number {
  const baseBudget = MODEL_BUDGETS[model]?.memory ?? 3_000;
  return getProportionalMemoryBudget(baseBudget, { model, totalContextTokens });
}

export function formatMemoryContext(memories: MemoryItem[], budgetTokens: number): string {
  const optimized = optimizeMemories(memories, budgetTokens);
  if (!optimized.length) return '';
  return '\n\n[Mémoire contextuelle]\n' + optimized.map(m => `• ${m.content}`).join('\n');
}

// ─── Résumé par LLM ─────────────────────────────────────────────────────────

const SUMMARIZE_SYSTEM_PROMPT = `Tu es un expert en compression de contexte technique.
Résume la conversation ci-dessous en préservant impérativement :
1. Les entités clés (fichiers, fonctions, variables, technos).
2. Les décisions techniques et d'architecture.
3. Les prochaines actions à mener (TODOs).
Sois concis et factuel.`;
/**
 * Résumé intelligent via LLM (appel à un modèle rapide/pas cher).
 * Fallback sur le résumé local si l'appel échoue.
 */
export async function summarizeWithLLM(
  messages: ChatMessage[],
  options: {
    apiKey?: string;
    model?: string;
    baseUrl?: string;
  } = {},
): Promise<{ summary: string; method: 'llm' | 'local'; tokensUsed: number }> {
  const {
    apiKey = process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_FREE_API_KEY || '',
    model = 'openai/gpt-4o-mini',
    // baseUrl = 'https://openrouter.ai/api/v1', // Pas utilisé actuellement, sera utilisé par generateText
  } = options;

  logInfo('summarizeWithLLM: début', { messageCount: messages.length, model, hasApiKey: !!apiKey });

  // Construire le texte de conversation à résumer
  const conversationText = messages
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.slice(0, 300)}`)
    .slice(0, 30)
    .join('\n');

  const inputTokens = estimateTokens(conversationText + SUMMARIZE_SYSTEM_PROMPT);
  logInfo('summarizeWithLLM: input préparé', { inputTokens, conversationChars: conversationText.length });

  // Si pas de clé API ou conversation trop courte, fallback local
  if (!apiKey || messages.length < 4) {
    logWarn('summarizeWithLLM: fallback local', { reason: !apiKey ? 'pas de clé API' : 'conversation trop courte (<4 messages)' });
    const summary = summarizeLocal(messages);
    const summaryTokens = estimateTokens(summary);
    
    // Validation : le résumé ne doit jamais être vide
    if (!summary || summary.trim().length === 0 || summaryTokens === 0) {
      const fallback = `Résumé de ${messages.length} messages de conversation.`;
      logWarn('summarizeWithLLM: résumé local vide, utilisation du fallback minimal');
      return { summary: fallback, method: 'local', tokensUsed: 0 };
    }
    
    logInfo('summarizeWithLLM: résumé local généré', { summaryTokens });
    return { summary, method: 'local', tokensUsed: 0 };
  }

  try {
    const { generateText } = await import('./textGeneration');
    const startTime = Date.now();

    const response = await generateText({
      prompt: `Conversation à résumer:\n\n${conversationText}`,
      systemPrompt: SUMMARIZE_SYSTEM_PROMPT,
      temperature: 0.3,
      maxTokens: 250,
    });

    const elapsed = Date.now() - startTime;
    const summary = response.text.trim();

    if (!summary) {
      logWarn('summarizeWithLLM: réponse vide du LLM, fallback local');
      return { summary: summarizeLocal(messages), method: 'local', tokensUsed: 0 };
    }

    const tokensUsed = estimateTokens(summary) + inputTokens;

    logSuccess('summarizeWithLLM: résumé LLM réussi', {
      elapsed: `${elapsed}ms`,
      provider: response.provider,
      model: response.model,
      inputMessages: messages.length,
      summaryTokens: estimateTokens(summary),
      compressionRatio: `${Math.round(inputTokens / estimateTokens(summary))}×`,
    });

    return { summary, method: 'llm', tokensUsed };
  } catch (err: any) {
    if (err.status === 402 || err.message?.includes("402")) {
      logWarn("Résumé ignoré : crédits OpenRouter insuffisants.");
    } else {
      logWarn('summarizeWithLLM: erreur réseau, fallback local', { error: (err as Error).message });
    }
    const summary = summarizeLocal(messages);
    
    // Validation : le résumé ne doit jamais être vide
    if (!summary || summary.trim().length === 0 || estimateTokens(summary) === 0) {
      const fallback = `Résumé de ${messages.length} messages de conversation (erreur LLM).`;
      return { summary: fallback, method: 'local', tokensUsed: 0 };
    }
    
    return { summary, method: 'local', tokensUsed: 0 };
  }
}

/**
 * Résumé local (fallback) — extraction des points clés sans LLM.
 * Meilleur que la simple troncature : extrait les questions/réponses clés.
 */
function summarizeLocal(messages: ChatMessage[]): string {
  const points: string[] = [];
  let lastUserQ = '';

  for (const msg of messages) {
    if (msg.role === 'user') {
      // Garder les questions/demandes (premières 100 chars)
      lastUserQ = msg.content.slice(0, 100).replace(/\n/g, ' ').trim();
    } else if (msg.role === 'assistant' && lastUserQ) {
      // Garder la première phrase de la réponse
      const firstSentence = msg.content.split(/[.!?\n]/).filter(s => s.trim().length > 10)[0] || '';
      if (firstSentence) {
        points.push(`Q: ${lastUserQ}${lastUserQ.length >= 100 ? '...' : ''}`);
        points.push(`R: ${firstSentence.trim().slice(0, 120)}`);
      }
      lastUserQ = '';
    }
  }

  // Si aucun point n'a été extrait (messages mal formés), créer un résumé minimal
  if (points.length === 0) {
    const fallbackSummary = messages
      .filter(m => m.content.trim().length > 0)
      .slice(0, 5)
      .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.slice(0, 80).replace(/\n/g, ' ')}...`)
      .join('\n');
    
    return fallbackSummary || `Conversation de ${messages.length} message(s) sans contenu exploitable.`;
  }

  // Max 10 paires Q/R (20 lignes)
  return points.slice(0, 20).join('\n');
}

// ─── Optimisation des messages OpenRouter (sliding window + LLM résumé) ──────

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OptimizeResult {
  messages: ChatMessage[];
  trimmed: number;
  summarized: boolean;
  summaryMethod?: 'llm' | 'local';
  summaryTokensCost?: number;
}

/**
 * Optimisation synchrone (fallback local) — pour compatibilité.
 */
export function optimizeMessages(
  messages: ChatMessage[],
  budget: TokenBudget,
): OptimizeResult {
  const maxConversationTokens = budget.conversationHistory;

  const systemMessages = messages.filter(m => m.role === 'system');
  const conversationMessages = messages.filter(m => m.role !== 'system');

  let totalConvTokens = 0;
  const tokenCounts = conversationMessages.map(m => {
    const t = estimateTokens(m.content);
    totalConvTokens += t;
    return t;
  });

  // Seuil de déclenchement : 70% du budget (anticipation avant dépassement)
  const TRIGGER_THRESHOLD = 0.70;
  const triggerAt = Math.floor(maxConversationTokens * TRIGGER_THRESHOLD);
  const usagePercent = Math.round((totalConvTokens / maxConversationTokens) * 100);

  logInfo('optimizeMessages (sync): analyse', {
    totalMessages: messages.length,
    systemMessages: systemMessages.length,
    conversationMessages: conversationMessages.length,
    totalConvTokens,
    maxConversationTokens,
    triggerAt,
    usagePercent: `${usagePercent}%`,
    withinBudget: totalConvTokens <= triggerAt,
  });

  if (totalConvTokens <= triggerAt) {
    logSuccess(`optimizeMessages: sous le seuil (${usagePercent}% < 70%), aucune optimisation nécessaire`);
    return { messages, trimmed: 0, summarized: false };
  }

  const minKeep = Math.min(8, conversationMessages.length);
  const keptMessages = conversationMessages.slice(-minKeep);
  const keptTokens = tokenCounts.slice(-minKeep).reduce((a, b) => a + b, 0);
  const remaining = conversationMessages.slice(0, -minKeep);
  const budgetForOld = maxConversationTokens - keptTokens - 500;

  logInfo('optimizeMessages: sliding window', {
    keeping: minKeep,
    keptTokens,
    trimming: remaining.length,
    budgetForSummary: budgetForOld,
  });

  let finalKept = keptMessages;

  if (remaining.length > 0 && budgetForOld > 0) {
    const summaryText = summarizeLocal(remaining);
    const summaryTokens = estimateTokens(summaryText);

    logInfo('optimizeMessages: résumé local généré', {
      inputMessages: remaining.length,
      summaryTokens,
      fitsInBudget: summaryTokens <= budgetForOld,
    });

    if (summaryTokens <= budgetForOld) {
      const summaryMessage: ChatMessage = {
        role: 'system',
        content: `[Résumé des ${remaining.length} messages précédents]\n${summaryText}`,
      };
      finalKept = [summaryMessage, ...keptMessages];
    }
  }

  logSuccess('optimizeMessages: terminé', {
    originalMessages: messages.length,
    finalMessages: [...systemMessages, ...finalKept].length,
    trimmed: remaining.length,
    tokensSaved: totalConvTokens - keptTokens,
  });

  return {
    messages: [...systemMessages, ...finalKept],
    trimmed: remaining.length,
    summarized: remaining.length > 0,
    summaryMethod: 'local',
  };
}

/**
 * Optimisation ASYNC avec résumé LLM — à utiliser quand possible.
 * Appelle un modèle rapide pour résumer les anciens messages.
 */
export async function optimizeMessagesWithLLM(
  messages: ChatMessage[],
  budget: TokenBudget,
  llmOptions?: { apiKey?: string; model?: string },
): Promise<OptimizeResult> {
  const maxConversationTokens = budget.conversationHistory;

  const systemMessages = messages.filter(m => m.role === 'system');
  const conversationMessages = messages.filter(m => m.role !== 'system');

  let totalConvTokens = 0;
  const tokenCounts = conversationMessages.map(m => {
    const t = estimateTokens(m.content);
    totalConvTokens += t;
    return t;
  });

  // Seuil de déclenchement : 70% du budget (anticipation avant dépassement)
  const TRIGGER_THRESHOLD = 0.70;
  const triggerAt = Math.floor(maxConversationTokens * TRIGGER_THRESHOLD);
  const usagePercent = Math.round((totalConvTokens / maxConversationTokens) * 100);

  logInfo('optimizeMessagesWithLLM (async): analyse', {
    totalMessages: messages.length,
    conversationMessages: conversationMessages.length,
    totalConvTokens,
    maxConversationTokens,
    triggerAt,
    usagePercent: `${usagePercent}%`,
    withinBudget: totalConvTokens <= triggerAt,
  });

  // Pas besoin d'optimiser si on est sous le seuil de 70%
  if (totalConvTokens <= triggerAt) {
    logSuccess(`optimizeMessagesWithLLM: sous le seuil (${usagePercent}% < 70%), pas d'optimisation`);
    return { messages, trimmed: 0, summarized: false };
  }

  logWarn('optimizeMessagesWithLLM: seuil 70% atteint, déclenchement anticipé', {
    usage: `${usagePercent}%`,
    triggerAt,
    excess: totalConvTokens - triggerAt,
  });

  const minKeep = Math.min(8, conversationMessages.length);
  const keptMessages = conversationMessages.slice(-minKeep);
  const keptTokens = tokenCounts.slice(-minKeep).reduce((a, b) => a + b, 0);
  const remaining = conversationMessages.slice(0, -minKeep);
  const budgetForOld = maxConversationTokens - keptTokens - 500;

  logInfo('optimizeMessagesWithLLM: sliding window', {
    keeping: minKeep,
    keptTokens,
    trimming: remaining.length,
    budgetForSummary: budgetForOld,
  });

  let finalKept = keptMessages;
  let summaryMethod: 'llm' | 'local' = 'local';
  let summaryTokensCost = 0;

  if (remaining.length > 0 && budgetForOld > 0) {
    logInfo('optimizeMessagesWithLLM: lancement résumé LLM...');
    const { summary, method, tokensUsed } = await summarizeWithLLM(remaining, llmOptions);
    summaryMethod = method;
    summaryTokensCost = tokensUsed;

    const summaryTokens = estimateTokens(summary);

    logInfo('optimizeMessagesWithLLM: résumé obtenu', {
      method,
      summaryTokens,
      costTokens: tokensUsed,
      fitsInBudget: summaryTokens <= budgetForOld,
    });

    if (summary && summaryTokens <= budgetForOld) {
      const summaryMessage: ChatMessage = {
        role: 'system',
        content: `[Résumé intelligent des ${remaining.length} messages précédents]\n${summary}`,
      };
      finalKept = [summaryMessage, ...keptMessages];
    }
  }

  const finalTokens = [...systemMessages, ...finalKept].reduce((sum, m) => sum + estimateTokens(m.content), 0);

  logSuccess('optimizeMessagesWithLLM: terminé', {
    originalMessages: messages.length,
    originalTokens: totalConvTokens,
    finalMessages: [...systemMessages, ...finalKept].length,
    finalTokens,
    trimmed: remaining.length,
    tokensSaved: totalConvTokens - finalTokens,
    summaryMethod,
    summaryCost: summaryTokensCost,
  });

  return {
    messages: [...systemMessages, ...finalKept],
    trimmed: remaining.length,
    summarized: remaining.length > 0,
    summaryMethod,
    summaryTokensCost,
  };
}

// ─── Configuration d'optimisation ────────────────────────────────────────────

export interface OptimizationConfig {
  compactPrompt: boolean;
  maxMemories: number;
  maxConversations: number;
  slidingWindow: boolean;
  autoSummarize: boolean;
  /** Utiliser le LLM pour résumer (vs troncature locale) */
  llmSummarize: boolean;
  /** Modèle à utiliser pour le résumé (rapide et pas cher) */
  summarizeModel: string;
}

export const DEFAULT_OPTIMIZATION: OptimizationConfig = {
  compactPrompt: true,
  maxMemories: 10,
  maxConversations: 3,
  slidingWindow: true,
  autoSummarize: true,
  llmSummarize: true,
  summarizeModel: 'openai/gpt-4o-mini',
};

// ─── Rapport d'optimisation ──────────────────────────────────────────────────

export interface OptimizationReport {
  systemPromptTokens: number;
  memoryTokens: number;
  totalEstimated: number;
  savings: number;
  suggestions: string[];
}

export function generateOptimizationReport(
  systemPrompt: string,
  memoryContext: string,
  config: OptimizationConfig,
): OptimizationReport {
  const systemPromptTokens = estimateTokens(systemPrompt);
  const memoryTokens = estimateTokens(memoryContext);
  const totalEstimated = systemPromptTokens + memoryTokens;

  const suggestions: string[] = [];
  let potentialSavings = 0;

  if (!config.compactPrompt && systemPromptTokens > 3000) {
    const saving = Math.round(systemPromptTokens * 0.4);
    suggestions.push(`Activer le mode compact : −${saving} tokens (~40% du prompt)`);
    potentialSavings += saving;
  }

  if (config.maxMemories > 5 && memoryTokens > 1000) {
    const saving = Math.round(memoryTokens * 0.5);
    suggestions.push(`Réduire les mémoires à 5 : −${saving} tokens`);
    potentialSavings += saving;
  }

  if (!config.llmSummarize) {
    suggestions.push(`Activer le résumé LLM : compression 5-10× des anciens messages`);
    potentialSavings += 2000;
  }

  if (config.maxConversations > 3) {
    suggestions.push(`Réduire l'historique à 3 conversations : −200-500 tokens`);
    potentialSavings += 300;
  }

  return {
    systemPromptTokens,
    memoryTokens,
    totalEstimated,
    savings: potentialSavings,
    suggestions,
  };
}
