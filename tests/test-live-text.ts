import { GoogleGenAI, Modality } from "@google/genai";
import dotenv from "dotenv";
dotenv.config();

async function test() {
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        console.log("Connecting...");
        const session = await ai.live.connect({
            model: "gemini-3.1-flash-live-preview",
            config: {
                systemInstruction: { parts: [{ text: "Si on te dit 'SECRET', réponds exactement par 'CONFIRMED' et rien d'autre." }] }
            },
            callbacks: {
                onmessage: (msg) => {
                    console.log("Message:", JSON.stringify(msg));
                },
                onerror: (e) => console.error("Error:", e),
                onclose: () => console.log("Closed")
            }
        });

        console.log("Connected!");
        session.sendClientContent({ turns: [{ role: 'user', parts: [{ text: 'SECRET' }] }] });
        
        setTimeout(() => {
            session.close();
        }, 5000);
    } catch (e) {
        console.error("Setup error:", e);
    }
}
test();
