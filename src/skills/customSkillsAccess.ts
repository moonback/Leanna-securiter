import { supabase } from '../services/supabase.js';

export interface CustomSkill {
  id: string;
  name: string;
  description: string;
  parameters: any[];
  instruction: string;
  category: string;
  icon: string;
}

/**
 * Skill permettant aux assistants de lister les compétences personnalisées disponibles.
 */
export const customSkillsAccessSkill = {
  /**
   * Récupère la liste des compétences personnalisées activées.
   */
  listEnabledSkills: async (): Promise<CustomSkill[]> => {
    const { data, error } = await supabase
      .from('custom_skills')
      .select('id, name, description, parameters, instruction, category, icon')
      .eq('enabled', true)
      .order('name');

    if (error) {
      throw new Error(`Erreur lors de la récupération des compétences personnalisées : ${error.message}`);
    }

    return (data ?? []) as CustomSkill[];
  },
};
