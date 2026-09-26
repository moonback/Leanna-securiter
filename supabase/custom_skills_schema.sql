-- ═══════════════════════════════════════════════════════════════════════════════
-- Table : custom_skills
-- Stocke les skills personnalisés créés par l'utilisateur via l'UI
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS custom_skills (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,                      -- Nom unique du skill (ex: "résumé_youtube")
  description text NOT NULL DEFAULT '',                   -- Description pour l'IA
  parameters  jsonb NOT NULL DEFAULT '[]'::jsonb,        -- Tableau de paramètres [{name, type, description, required}]
  instruction text NOT NULL DEFAULT '',                   -- Prompt/instruction que l'IA exécutera
  category    text NOT NULL DEFAULT 'custom',            -- Catégorie (custom, automation, web, data...)
  enabled     boolean NOT NULL DEFAULT true,             -- Actif ou désactivé
  icon        text DEFAULT 'Sparkles',                   -- Nom d'icône Lucide
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Index pour filtrer rapidement les skills actifs
CREATE INDEX IF NOT EXISTS idx_custom_skills_enabled ON custom_skills (enabled) WHERE enabled = true;

-- Politique RLS : accès réservé au service_role (backend)
ALTER TABLE custom_skills ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON custom_skills
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Trigger auto-update pour updated_at
CREATE OR REPLACE FUNCTION update_custom_skills_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_custom_skills_updated_at
  BEFORE UPDATE ON custom_skills
  FOR EACH ROW
  EXECUTE FUNCTION update_custom_skills_updated_at();
