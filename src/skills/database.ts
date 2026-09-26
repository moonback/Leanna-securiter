import { supabase } from '../services/supabase.js'

/**
 * Skill permettant à Leanna d'effectuer des modifications sur la base de données Supabase.
 */
export const databaseSkill = {
  /**
   * Met à jour des données dans une table spécifique.
   * @param table Nom de la table
   * @param data Objet contenant les champs à mettre à jour
   * @param match Objet définissant la condition de correspondance (ex: { id: 1 })
   */
  update: async (table: string, data: object, match: object) => {
    const { data: result, error } = await supabase
      .from(table)
      .update(data)
      .match(match)
    
    if (error) {
      console.error(`Erreur lors de la mise à jour dans ${table}:`, error)
      throw error
    }
    return result
  },

  /**
   * Insère de nouvelles données dans une table.
   * @param table Nom de la table
   * @param data Objet ou tableau d'objets à insérer
   */
  insert: async (table: string, data: object | object[]) => {
    const { data: result, error } = await supabase
      .from(table)
      .insert(data)
    
    if (error) {
      console.error(`Erreur lors de l'insertion dans ${table}:`, error)
      throw error
    }
    return result
  },

  /**
   * Supprime des données dans une table.
   * @param table Nom de la table
   * @param match Objet définissant la condition de correspondance pour la suppression
   */
  delete: async (table: string, match: object) => {
    const { data: result, error } = await supabase
      .from(table)
      .delete()
      .match(match)
    
    if (error) {
      console.error(`Erreur lors de la suppression dans ${table}:`, error)
      throw error
    }
    return result
  }
}
