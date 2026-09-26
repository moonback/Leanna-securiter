import { Skill, validateArgs } from "./base.js";
import { z } from "zod";

export const weatherSkill: Skill = {
  name: "weather",
  declarations: [
    {
      name: "get_weather",
      description: "Obtenir la météo actuelle pour une ville donnée.",
      parameters: {
        type: "OBJECT",
        properties: {
          city: { type: "STRING", description: "Le nom de la ville, par exemple Paris, Tokyo" }
        },
        required: ["city"]
      }
    }
  ],
  inputSchemas: {
    "get_weather": z.object({
      city: z.string().min(1, "Le nom de la ville est requis")
    })
  },
  handleToolCall: async (name, args) => {
    if (name === "get_weather") {
       // Validation des paramètres
       const validatedArgs = validateArgs(weatherSkill.inputSchemas!["get_weather"], args);
       
       try {
           const geoController = new AbortController();
           const geoTimeoutId = setTimeout(() => geoController.abort(), 8000);
           const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(validatedArgs.city)}&count=1&language=fr&format=json`, {
               signal: geoController.signal
           });
           clearTimeout(geoTimeoutId);
           const geoData = await geoRes.json();
           
           if (!geoData.results || geoData.results.length === 0) {
               return { error: "Ville non trouvée" };
           }
           
           const { latitude, longitude, name: cityName } = geoData.results[0];
           const weatherController = new AbortController();
           const weatherTimeoutId = setTimeout(() => weatherController.abort(), 8000);
           const weatherRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code&timezone=auto`, {
               signal: weatherController.signal
           });
           clearTimeout(weatherTimeoutId);
           const weatherData = await weatherRes.json();
           
           return {
               city: cityName,
               temperature_celsius: weatherData.current.temperature_2m,
               weather_code: weatherData.current.weather_code,
               note: "Tu peux interpréter le weather_code (0=clair, 1-3=nuageux, 45=brouillard, 51-55=bruine, 61-65=pluie, 71-75=neige, 95=orage)"
           };
       } catch (e: any) {
           return { error: e.message };
       }
    }
  }
};
