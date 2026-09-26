import { Skill, validateArgs } from "./base.js";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

type ListEntry = {
  name: string;
  items: string[];
  createdAt: string;
  updatedAt: string;
};

type ListRow = {
  name: string;
  name_lower: string;
  items: string[];
  created_at: string;
  updated_at: string;
};

function getSupabaseClient() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Veuillez configurer SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY pour gérer les listes en base de données.");
  }
  return createClient(supabaseUrl, supabaseKey);
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

function toListEntry(row: ListRow): ListEntry {
  return {
    name: row.name,
    items: Array.isArray(row.items) ? row.items.map(item => String(item)) : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listAll(): Promise<ListEntry[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("lists")
    .select("name, items, created_at, updated_at")
    .order("updated_at", { ascending: false }) as { data: ListRow[] | null; error: { message: string; code?: string } | null };

  if (error) {
    throw error;
  }

  return (data || []).map(toListEntry);
}

export async function getListByName(name: string): Promise<ListEntry | null> {
  const supabase = getSupabaseClient();
  const normalizedName = normalizeName(name);
  const { data, error } = await supabase
    .from("lists")
    .select("name, items, created_at, updated_at")
    .eq("name_lower", normalizedName)
    .limit(1)
    .single() as { data: ListRow | null; error: { message: string; code?: string } | null };

  if (error && error.code !== "PGRST116") {
    throw error;
  }

  return data ? toListEntry(data) : null;
}

export async function createList(name: string, items: string[]): Promise<ListEntry> {
  const supabase = getSupabaseClient();
  const normalizedName = normalizeName(name);
  const cleanItems = items.filter(item => typeof item === "string").map(item => item.trim()).filter(Boolean);

  const existing = await getListByName(name);
  if (existing) {
    throw new Error(`Une liste nommée '${name}' existe déjà.`);
  }

  const { data, error } = await supabase
    .from("lists")
    .insert([{ name: name.trim(), name_lower: normalizedName, items: cleanItems, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }])
    .select("name, items, created_at, updated_at")
    .single() as { data: ListRow | null; error: { message: string; code?: string } | null };

  if (error) {
    throw error;
  }

  return toListEntry(data as ListRow);
}

export async function addItemToList(name: string, item: string): Promise<ListEntry> {
  const list = await getListByName(name);
  if (!list) {
    throw new Error(`La liste '${name}' n'a pas été trouvée.`);
  }
  const cleanItem = item.trim();
  if (!cleanItem) {
    throw new Error("L'élément à ajouter doit être une chaîne non vide.");
  }

  const supabase = getSupabaseClient();
  const updatedItems = [...list.items, cleanItem];
  const { data, error } = await supabase
    .from("lists")
    .update({ items: updatedItems, updated_at: new Date().toISOString() })
    .eq("name_lower", normalizeName(name))
    .select("name, items, created_at, updated_at")
    .single() as { data: ListRow | null; error: { message: string; code?: string } | null };

  if (error) {
    throw error;
  }

  return toListEntry(data as ListRow);
}

export async function removeItemFromList(name: string, item?: string, index?: number): Promise<ListEntry> {
  const list = await getListByName(name);
  if (!list) {
    throw new Error(`La liste '${name}' n'a pas été trouvée.`);
  }

  const updatedItems = [...list.items];

  if (typeof index === "number") {
    if (index < 0 || index >= updatedItems.length) {
      throw new Error("Index hors limites pour la suppression.");
    }
    updatedItems.splice(index, 1);
  } else if (typeof item === "string" && item.trim()) {
    const itemIndex = updatedItems.findIndex(current => current === item.trim());
    if (itemIndex === -1) {
      throw new Error(`L'élément '${item}' n'a pas été trouvé dans la liste.`);
    }
    updatedItems.splice(itemIndex, 1);
  } else {
    throw new Error("Vous devez fournir un 'item' ou un 'index' valide à supprimer.");
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("lists")
    .update({ items: updatedItems, updated_at: new Date().toISOString() })
    .eq("name_lower", normalizeName(name))
    .select("name, items, created_at, updated_at")
    .single() as { data: ListRow | null; error: { message: string; code?: string } | null };

  if (error) {
    throw error;
  }

  return toListEntry(data as ListRow);
}

export async function deleteList(name: string): Promise<ListEntry> {
  const list = await getListByName(name);
  if (!list) {
    throw new Error(`La liste '${name}' n'a pas été trouvée.`);
  }

  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("lists")
    .delete()
    .eq("name_lower", normalizeName(name)) as { error: { message: string; code?: string } | null };

  if (error) {
    throw error;
  }

  return list;
}

const listNameSchema = z.string().min(1, "Le nom de la liste est requis").trim();

export const listSkill: Skill = {
  name: "list",
  declarations: [
    {
      name: "list_create",
      description: "Créer une nouvelle liste avec un nom et des éléments facultatifs.",
      parameters: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING", description: "Le nom de la liste à créer." },
          items: {
            type: "ARRAY",
            items: { type: "STRING" },
            description: "Liste d'éléments initiale. Peut être vide." 
          }
        },
        required: ["name"]
      }
    },
    {
      name: "list_add_item",
      description: "Ajouter un élément à une liste existante.",
      parameters: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING", description: "Le nom de la liste existante." },
          item: { type: "STRING", description: "L'élément à ajouter." }
        },
        required: ["name", "item"]
      }
    },
    {
      name: "list_remove_item",
      description: "Supprimer un élément d'une liste existante par valeur ou par position.",
      parameters: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING", description: "Le nom de la liste." },
          item: { type: "STRING", description: "L'élément à supprimer (valeur exacte)." },
          index: { type: "NUMBER", description: "Position de l'élément à supprimer (0-based)." }
        },
        required: ["name"]
      }
    },
    {
      name: "list_delete",
      description: "Supprimer une liste entière par son nom.",
      parameters: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING", description: "Le nom de la liste à supprimer." }
        },
        required: ["name"]
      }
    },
    {
      name: "list_get",
      description: "Récupérer une liste existante par son nom.",
      parameters: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING", description: "Le nom de la liste à récupérer." }
        },
        required: ["name"]
      }
    },
    {
      name: "list_list_all",
      description: "Lister toutes les listes enregistrées avec leur taille.",
      parameters: {
        type: "OBJECT",
        properties: {}
      }
    }
  ],
  inputSchemas: {
    "list_create": z.object({
      name: listNameSchema,
      items: z.array(z.string().trim()).optional().default([])
    }),
    "list_add_item": z.object({
      name: listNameSchema,
      item: z.string().min(1, "L'élément à ajouter ne peut être vide").trim()
    }),
    "list_remove_item": z.object({
      name: listNameSchema,
      item: z.string().trim().optional(),
      index: z.number().int().nonnegative().optional()
    }).refine(data => data.item !== undefined || data.index !== undefined, {
      message: "Vous devez fournir soit 'item' soit 'index'"
    }),
    "list_delete": z.object({
      name: listNameSchema
    }),
    "list_get": z.object({
      name: listNameSchema
    }),
    "list_list_all": z.object({})
  },
  handleToolCall: async (name, args) => {
    try {
      if (name === "list_create") {
        const validated = validateArgs(listSkill.inputSchemas!["list_create"], args);
        const newList = await createList(validated.name, validated.items);
        return { status: "success", list: newList };
      }

      if (name === "list_add_item") {
        const validated = validateArgs(listSkill.inputSchemas!["list_add_item"], args);
        const updatedList = await addItemToList(validated.name, validated.item);
        return { status: "success", list: updatedList };
      }

      if (name === "list_remove_item") {
        const validated = validateArgs(listSkill.inputSchemas!["list_remove_item"], args);
        const updatedList = await removeItemFromList(validated.name, validated.item, validated.index);
        return { status: "success", list: updatedList };
      }

      if (name === "list_delete") {
        const validated = validateArgs(listSkill.inputSchemas!["list_delete"], args);
        const deletedList = await deleteList(validated.name);
        return { status: "success", list: deletedList };
      }

      if (name === "list_get") {
        const validated = validateArgs(listSkill.inputSchemas!["list_get"], args);
        const list = await getListByName(validated.name);
        if (!list) {
          return { error: `La liste '${validated.name}' n'a pas été trouvée.` };
        }
        return { status: "success", list };
      }

      if (name === "list_list_all") {
        validateArgs(listSkill.inputSchemas!["list_list_all"], args);
        const lists = await listAll();
        return { status: "success", lists: lists.map(list => ({ name: list.name, count: list.items.length, updatedAt: list.updatedAt })) };
      }

      return { error: "Outil inconnu pour le skill de listes." };
    } catch (e: any) {
      return { error: e.message || "Erreur lors du traitement du skill de listes." };
    }
  }
};
