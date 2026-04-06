/**
 * GEZIA — LLM Client
 * Wrapper sobre OpenAI GPT-4o para todos los módulos del pipeline.
 */

const MODEL = "gpt-4o";
const MODEL_VERSION = "gpt-4o-2024-11-20";

export interface LLMCallResult {
  content: string;
  modelVersion: string;
  promptTokens: number;
  completionTokens: number;
}

export async function callLLM(
  systemPrompt: string,
  userPrompt: string,
  jsonMode = true,
): Promise<LLMCallResult> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
      response_format: jsonMode
        ? { type: "json_object" }
        : { type: "text" },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI error ${response.status}: ${body.substring(0, 400)}`);
  }

  const data = await response.json();
  return {
    content: data.choices[0].message.content as string,
    modelVersion: MODEL_VERSION,
    promptTokens: data.usage?.prompt_tokens ?? 0,
    completionTokens: data.usage?.completion_tokens ?? 0,
  };
}

export function parseLLMJson<T>(content: string): T {
  try {
    return JSON.parse(content) as T;
  } catch {
    throw new Error(`Failed to parse LLM JSON output: ${content.substring(0, 200)}`);
  }
}

export { MODEL_VERSION };
