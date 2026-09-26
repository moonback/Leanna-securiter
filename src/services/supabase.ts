import { createClient } from '@supabase/supabase-js'

// Récupération des variables d'environnement
// Assurez-vous que SUPABASE_URL et SUPABASE_ANON_KEY sont définis dans votre fichier .env
const supabaseUrl = process.env.SUPABASE_URL
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Les variables SUPABASE_URL et SUPABASE_ANON_KEY doivent être définies dans le fichier .env')
}

// Initialisation du client Supabase
export const supabase = createClient(supabaseUrl, supabaseAnonKey)

/**
 * Exemple d'utilisation pour modifier des données :
 * 
 * async function updateData(table, data, matchCondition) {
 *   const { data: result, error } = await supabase
 *     .from(table)
 *     .update(data)
 *     .match(matchCondition)
 *   
 *   if (error) throw error
 *   return result
 * }
 */
