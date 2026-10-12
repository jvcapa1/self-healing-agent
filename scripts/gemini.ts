import "dotenv/config";
import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;

if (!apiKey) {
  console.error("Set GEMINI_API_KEY (or GOOGLE_API_KEY) in your environment or .env file.");
  process.exit(1);
}

async function main() {
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: "gemini-flash-latest",
    contents: 'Say exactly "hello world" and nothing else.',
  });

  const answer = response.text?.trim();
  if (!answer) {
    throw new Error("Gemini returned an empty response.");
  }

  console.log(`Prompt: Say exactly "hello world" and nothing else.`);
  console.log(`Gemini: ${answer}`);
}

main().catch((error: unknown) => {
  console.error("Gemini prompt test failed:", error);
  process.exitCode = 1;
});
