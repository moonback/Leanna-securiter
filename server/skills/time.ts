import { Skill } from "./base.js";

export const timeSkill: Skill = {
  name: "time",
  declarations: [
    {
      name: "get_current_time",
      description: "Obtenir l'heure et la date actuelles du système",
    }
  ],
  // Pas de validation nécessaire pour cet outil car pas d'arguments.
  handleToolCall: async (name) => {
    if (name === "get_current_time") {
        return { 
           time: new Date().toLocaleTimeString('fr-FR'),
           date: new Date().toLocaleDateString('fr-FR')
        };
    }
  }
};
