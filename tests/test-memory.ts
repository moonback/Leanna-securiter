import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
dotenv.config();

async function test() {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    try {
        console.log("Generating embedding with outputDimensionality...");
        const response = await ai.models.embedContent({
            model: 'gemini-embedding-2',
            contents: 'Hello world',
            config: {
                outputDimensionality: 768
            }
        });
        console.log("dim:", response.embeddings[0].values.length);
    } catch (e) {
        console.error("Error:", e.message);
    }
}
test();
