/**
 * OpenAI chat completions with JSON-shaped outputs.
 */

import OpenAI from "openai";
import { logger } from "../utils/logger.js";

export class OpenAiClient {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(apiKey: string, model: string) {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async completeJson<T>(system: string, user: string): Promise<T> {
    const res = await this.client.chat.completions.create({
      model: this.model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.35,
    });
    const text = res.choices[0]?.message?.content;
    if (!text) {
      throw new Error("OpenAI returned empty content");
    }
    try {
      return JSON.parse(text) as T;
    } catch (e) {
      logger.error("openai_json_parse_failed", { snippet: text.slice(0, 400) });
      throw e;
    }
  }
}
