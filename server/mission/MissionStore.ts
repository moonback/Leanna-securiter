import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { MissionState } from "./types.js";

// ═══════════════════════════════════════════════════════════════════════════════
// MissionStore — Persistance des missions dans Supabase
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Persiste l'état des missions pour survivre à un redémarrage/crash.
 *
 * Conception défensive :
 *   - Si SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY sont absents, le store est
 *     un no-op silencieux (isEnabled() renvoie false). Les missions continuent
 *     de fonctionner en mémoire, sans persistance.
 *   - Toute erreur d'écriture est journalisée mais n'interrompt jamais une mission.
 *
 * Table attendue (voir SQL de création en fin de fichier) :
 *   missions(id uuid pk, title text, status text, priority text,
 *            state jsonb, created_at timestamptz, updated_at timestamptz)
 */
export class MissionStore {
  private client: SupabaseClient | null = null;
  private readonly table = "missions";
  private tableMissingLogged = false;

  constructor() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (url && key) {
      try {
        this.client = createClient(url, key);
      } catch (err) {
        console.warn(`[MissionStore] ⚠️ Client Supabase non initialisé: ${(err as Error).message}`);
        this.client = null;
      }
    } else {
      console.log(`[MissionStore] ℹ️ Supabase non configuré — persistance des missions désactivée.`);
    }
  }

  /** Indique si la persistance est active. */
  isEnabled(): boolean {
    return this.client !== null;
  }

  /**
   * Sauvegarde (upsert) l'état d'une mission.
   * Ne lève jamais : les erreurs sont journalisées.
   */
  async save(state: MissionState): Promise<void> {
    if (!this.client) return;

    try {
      const { error } = await this.client.from(this.table).upsert(
        {
          id: state.id,
          title: state.title,
          status: state.status,
          priority: state.priority,
          state: state,
          created_at: state.createdAt,
          updated_at: state.updatedAt,
        },
        { onConflict: "id" }
      );

      if (error) this.handleError("save", error);
    } catch (err) {
      this.handleError("save", err);
    }
  }

  /**
   * Charge l'état d'une mission par ID. Renvoie null si introuvable/désactivé.
   */
  async load(missionId: string): Promise<MissionState | null> {
    if (!this.client) return null;

    try {
      const { data, error } = await this.client
        .from(this.table)
        .select("state")
        .eq("id", missionId)
        .maybeSingle();

      if (error) {
        this.handleError("load", error);
        return null;
      }
      return (data?.state as MissionState) ?? null;
    } catch (err) {
      this.handleError("load", err);
      return null;
    }
  }

  /**
   * Liste les états de missions dont le statut est dans `statuses`.
   * Utilisé au démarrage pour reprendre les missions interrompues.
   */
  async listByStatus(statuses: string[]): Promise<MissionState[]> {
    if (!this.client) return [];

    try {
      const { data, error } = await this.client
        .from(this.table)
        .select("state")
        .in("status", statuses)
        .order("updated_at", { ascending: false });

      if (error) {
        this.handleError("listByStatus", error);
        return [];
      }
      return (data ?? [])
        .map((row: { state: MissionState }) => row.state)
        .filter((s): s is MissionState => !!s && typeof s === "object");
    } catch (err) {
      this.handleError("listByStatus", err);
      return [];
    }
  }

  /** Supprime une mission persistée (nettoyage optionnel). */
  async delete(missionId: string): Promise<void> {
    if (!this.client) return;
    try {
      const { error } = await this.client.from(this.table).delete().eq("id", missionId);
      if (error) this.handleError("delete", error);
    } catch (err) {
      this.handleError("delete", err);
    }
  }

  private handleError(op: string, error: unknown): void {
    const message = (error as { message?: string })?.message ?? String(error);
    // La table peut ne pas exister : ne le signaler qu'une fois.
    if (/relation .* does not exist|could not find the table|42P01/i.test(message)) {
      if (!this.tableMissingLogged) {
        console.warn(
          `[MissionStore] ⚠️ Table "${this.table}" absente dans Supabase — persistance ignorée. ` +
            `Exécutez supabase/missions_schema.sql dans Supabase (puis NOTIFY pgrst, 'reload schema') ` +
            `pour activer la reprise des missions.`
        );
        this.tableMissingLogged = true;
      }
      return;
    }
    console.warn(`[MissionStore] ⚠️ Erreur ${op}: ${message}`);
  }
}

/*
── Schéma de la table `missions` ───────────────────────────────────────────────
Le SQL de création (table + index + RLS) est maintenu dans un fichier dédié :
    supabase/missions_schema.sql
À exécuter dans l'éditeur SQL Supabase, puis rafraîchir le cache PostgREST avec :
    NOTIFY pgrst, 'reload schema';
─────────────────────────────────────────────────────────────────────────────── */
