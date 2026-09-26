import { getSupabaseClient } from '../../utils/supabaseClient.js';

const supabase = getSupabaseClient();

export const memoryManagerSkill = {
  name: 'Memory Manager',
  description: 'Gère de manière autonome la mémoire en supprimant ou mettant à jour les informations.',

  // Exemple: Supprimer les anciennes mémoires (plus de 30 jours)
  async cleanOldMemories() {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { error } = await supabase
      .from('memories')
      .delete()
      .lt('created_at', thirtyDaysAgo.toISOString());

    if (error) {
      console.error('Erreur lors du nettoyage de la mémoire:', error);
      return false;
    }
    return true;
  },
  
  // placeholder pour update
  async updateMemoryContext() {
      // logique à implémenter
      return true;
  }
};
