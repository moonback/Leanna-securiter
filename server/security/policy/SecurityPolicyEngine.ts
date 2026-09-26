/**
 * SecurityPolicyEngine — Moteur de décision d'accès sécurité (Phase 5)
 *
 * Répond aux questions de gouvernance que la SecurityCapability doit poser
 * AVANT toute action, de manière centralisée et testable :
 *
 *   canRead(target)       — lecture d'un chemin
 *   canScan(target)       — analyse statique d'un chemin
 *   canNetwork(target)    — enrichissement / requête réseau
 *   canExecute(target)    — exécution de commande (toujours refusé ici)
 *   canModify(target)     — écriture / mutation
 *   canRemediate(finding) — application d'un correctif (approbation requise)
 *   canRunDast(target)    — analyse dynamique (classification de cible)
 *
 * Principe : refus par défaut hors du workspace ; la DAST est classée par
 * environnement cible (production → refus, staging → approbation, localhost →
 * autorisé, inconnu → approbation).
 */

import path from 'node:path';
import fs from 'node:fs';

// ---------------------------------------------------------------------------
// Types de décision
// ---------------------------------------------------------------------------

export type PolicyEffect = 'allow' | 'deny' | 'approval';

export interface PolicyDecision {
  effect: PolicyEffect;
  reason: string;
  /** Cible normalisée/canonique évaluée (chemin ou URL). */
  target?: string;
}

export type DastTargetClass = 'localhost' | 'staging' | 'production' | 'unknown';

const allow = (reason: string, target?: string): PolicyDecision => ({ effect: 'allow', reason, target });
const deny = (reason: string, target?: string): PolicyDecision => ({ effect: 'deny', reason, target });
const approval = (reason: string, target?: string): PolicyDecision => ({ effect: 'approval', reason, target });

export interface SecurityPolicyOptions {
  /** Autorise l'enrichissement réseau (OSV/EPSS/KEV). Défaut : true. */
  allowNetwork?: boolean;
  /** Autorise les mutations (remédiation). Défaut : false (audit read-only). */
  allowWrite?: boolean;
}

// ---------------------------------------------------------------------------
// Moteur
// ---------------------------------------------------------------------------

export class SecurityPolicyEngine {
  private readonly workspaceRoot: string;
  private readonly allowNetwork: boolean;
  private readonly allowWrite: boolean;

  constructor(workspaceRoot: string, options: SecurityPolicyOptions = {}) {
    if (!workspaceRoot || !workspaceRoot.trim()) {
      throw new Error('[SecurityPolicyEngine] workspaceRoot requis.');
    }
    this.workspaceRoot = workspaceRoot;
    this.allowNetwork = options.allowNetwork ?? true;
    this.allowWrite = options.allowWrite ?? false;
  }

  // --- Containment de chemin ------------------------------------------------

  /**
   * Résout une cible strictement à l'intérieur du workspace, en refusant
   * chemins absolus, remontées `..`, lettres de lecteur, UNC et sorties via
   * symlink/junction. Renvoie le chemin canonique ou `null` si hors périmètre.
   */
  resolveInsideWorkspace(target?: string): string | null {
    const realRoot = this.safeRealpath(path.resolve(this.workspaceRoot));

    if (target === undefined || target === null || target.trim() === '' || target.trim() === '.') {
      return realRoot;
    }

    const requested = target.trim();
    if (
      path.isAbsolute(requested) ||
      path.win32.isAbsolute(requested) ||
      path.posix.isAbsolute(requested) ||
      /^[a-zA-Z]:/.test(requested) ||
      requested.startsWith('\\\\')
    ) {
      return null;
    }

    const candidate = path.resolve(realRoot, requested);
    const real = this.safeRealpath(candidate);
    const rel = path.relative(realRoot, real);
    if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
      return null;
    }
    return real;
  }

  private safeRealpath(p: string): string {
    try {
      return fs.existsSync(p) ? fs.realpathSync(p) : p;
    } catch {
      return p;
    }
  }

  // --- Décisions par capacité ----------------------------------------------

  canRead(target?: string): PolicyDecision {
    const resolved = this.resolveInsideWorkspace(target);
    return resolved
      ? allow('cible interne au workspace', resolved)
      : deny('cible hors du workspace (lecture refusée)', target);
  }

  canScan(target?: string): PolicyDecision {
    // Scanner = lire + analyser ; même contrainte de containment.
    const resolved = this.resolveInsideWorkspace(target);
    return resolved
      ? allow('cible interne au workspace', resolved)
      : deny('cible hors du workspace (scan refusé)', target);
  }

  canNetwork(target?: string): PolicyDecision {
    if (!this.allowNetwork) {
      return deny('enrichissement réseau désactivé par la politique', target);
    }
    return allow('accès réseau autorisé pour enrichissement', target);
  }

  canExecute(target?: string): PolicyDecision {
    // La capacité sécurité n'exécute JAMAIS de commande arbitraire.
    return deny('exécution de commande interdite pour la capacité sécurité', target);
  }

  canModify(target?: string): PolicyDecision {
    if (!this.allowWrite) {
      return deny('mutation interdite (audit en lecture seule)', target);
    }
    const resolved = this.resolveInsideWorkspace(target);
    return resolved
      ? approval('mutation interne autorisée sous réserve d\'approbation', resolved)
      : deny('mutation hors du workspace refusée', target);
  }

  canRemediate(finding: { id?: string; severity?: string } | undefined): PolicyDecision {
    if (!this.allowWrite) {
      return deny('remédiation interdite (audit en lecture seule)');
    }
    // Toute remédiation passe par une approbation explicite (jamais implicite).
    return approval(
      `remédiation du finding ${finding?.id ?? '?'} nécessite une approbation explicite`
    );
  }

  // --- DAST : classification de cible (section 13) --------------------------

  /**
   * Classe une URL/hôte cible pour la DAST :
   *   - localhost / 127.0.0.1 / ::1 / *.localhost / 0.0.0.0 → localhost
   *   - hôtes contenant "staging"/"preprod"/"uat"/"test."   → staging
   *   - hôtes contenant "prod"/"www."/TLD publics apparents → production
   *   - reste → unknown
   */
  classifyDastTarget(rawTarget: string): DastTargetClass {
    let host = rawTarget.trim().toLowerCase();
    try {
      // Ajoute un schéma si absent pour permettre le parse URL.
      const url = new URL(/^[a-z]+:\/\//.test(host) ? host : `http://${host}`);
      host = url.hostname;
    } catch {
      // conserve la chaîne brute si non parsable
    }

    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host === '0.0.0.0' ||
      host.endsWith('.localhost')
    ) {
      return 'localhost';
    }

    if (/(^|[.\-])(staging|preprod|pre-prod|uat|qa|dev|sandbox)([.\-]|$)|(^|[.\-])test([.\-])/.test(host)) {
      return 'staging';
    }

    if (/(^|[.\-])(prod|production|www)([.\-]|$)|\.(com|net|org|io|app|dev|co)$/.test(host)) {
      return 'production';
    }

    return 'unknown';
  }

  /**
   * Décision DAST. `explicitOptIn` reste nécessaire mais n'est plus le seul
   * garde-fou : la classe de cible impose une politique supplémentaire.
   */
  canRunDast(rawTarget: string, explicitOptIn: boolean): PolicyDecision {
    if (!rawTarget || !rawTarget.trim()) {
      return deny('aucune cible DAST fournie');
    }
    if (!explicitOptIn) {
      return deny('opt-in explicite requis pour la DAST', rawTarget);
    }

    const cls = this.classifyDastTarget(rawTarget);
    switch (cls) {
      case 'localhost':
        return allow('cible locale : DAST autorisée', rawTarget);
      case 'staging':
        return approval('cible de préproduction : approbation requise', rawTarget);
      case 'production':
        return deny('cible de production : DAST interdite', rawTarget);
      case 'unknown':
      default:
        return approval('cible non classée : approbation requise', rawTarget);
    }
  }
}
