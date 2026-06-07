import { tool } from "ai";
import { z } from "zod";
import { saveImageBase64 } from "./image-store";
import { logger } from "../../logger";

const SIZES = ["1024x1024", "1536x1024", "1024x1536", "auto"] as const;
const QUALITIES = ["low", "medium", "high", "auto"] as const;

const OPENAI_IMAGE_ENDPOINT = "https://api.openai.com/v1/images/generations";
const OPENAI_IMAGE_MODEL = "gpt-image-1";

/**
 * Generate an image from a text prompt using OpenAI's official image model
 * (gpt-image-1). The model returns base64 image data which we persist to disk
 * and expose as a URL, so the chat transcript stays small and the frontend can
 * display, zoom, and download the result.
 */
export const generateImage = tool({
  description:
    "Generate an image from a text prompt using OpenAI's gpt-image-1 model. " +
    "Use this whenever the user asks to create, draw, generate, paint, design, " +
    "or illustrate an image, picture, photo, logo, icon, or artwork. " +
    "The generated image is shown directly to the user, so you do not need to " +
    "describe it in detail afterwards — a short confirmation is enough.",
  inputSchema: z.object({
    prompt: z
      .string()
      .min(1)
      .describe(
        "A detailed description of the image to generate. Be specific about " +
          "the subject, style, colors, mood, and composition. May be written " +
          "in any language.",
      ),
    size: z
      .enum(SIZES)
      .optional()
      .describe(
        "Image dimensions: '1024x1024' (square), '1536x1024' (landscape), " +
          "'1024x1536' (portrait), or 'auto'. Defaults to '1024x1024'.",
      ),
    quality: z
      .enum(QUALITIES)
      .optional()
      .describe(
        "Rendering quality: 'low', 'medium', 'high', or 'auto'. Higher quality " +
          "is slower and more expensive. Defaults to 'auto'.",
      ),
  }),
  execute: async ({ prompt, size = "1024x1024", quality = "auto" }) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return {
        success: false,
        error:
          "OPENAI_API_KEY is not configured on the server. Add it to packages/api-server/.env and restart.",
      };
    }

    try {
      const resp = await fetch(OPENAI_IMAGE_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: OPENAI_IMAGE_MODEL,
          prompt,
          n: 1,
          size,
          quality,
        }),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        logger.error(
          `[generateImage] OpenAI error ${resp.status}: ${errText.slice(0, 500)}`,
        );
        let message = `OpenAI image API error (HTTP ${resp.status}).`;
        try {
          const parsed = JSON.parse(errText);
          if (parsed?.error?.message) message = parsed.error.message;
        } catch {
          /* keep generic message */
        }
        return { success: false, error: message };
      }

      const data = (await resp.json()) as {
        data?: { b64_json?: string; revised_prompt?: string }[];
      };
      const item = data?.data?.[0];
      if (!item?.b64_json) {
        return { success: false, error: "OpenAI returned no image data." };
      }

      const { url, fileName } = await saveImageBase64(item.b64_json, "png");
      logger.info(`[generateImage] saved ${fileName} (size=${size}, quality=${quality})`);

      return {
        success: true,
        url,
        fileName,
        prompt,
        revisedPrompt: item.revised_prompt,
        size,
        quality,
        model: OPENAI_IMAGE_MODEL,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[generateImage] failed: ${message}`);
      return { success: false, error: message };
    }
  },
});
