import { tool } from "ai";
import { z } from "zod";
import { saveImageBase64 } from "./image-store";
import { logger } from "../../logger";

const SIZES = ["1024x1024", "1536x1024", "1024x1536", "auto"] as const;
const QUALITIES = ["low", "medium", "high", "auto"] as const;

// Endpoints and model are configurable via env so the image backend can be
// swapped without code changes. Defaults target OpenAI's latest model.
const OPENAI_IMAGE_ENDPOINT =
  process.env.OPENAI_IMAGE_ENDPOINT ?? "https://api.openai.com/v1/images/generations";
const OPENAI_IMAGE_EDIT_ENDPOINT =
  process.env.OPENAI_IMAGE_EDIT_ENDPOINT ?? "https://api.openai.com/v1/images/edits";
const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-2";

interface OpenAIImageResponse {
  data?: { b64_json?: string; revised_prompt?: string }[];
}

/** Extract a human-readable error from an OpenAI error response body. */
function parseOpenAIError(status: number, errText: string): string {
  let message = `OpenAI image API error (HTTP ${status}).`;
  try {
    const parsed = JSON.parse(errText);
    if (parsed?.error?.message) message = parsed.error.message;
  } catch {
    /* keep generic message */
  }
  return message;
}

/**
 * Text-to-image via the generations endpoint.
 */
async function generateFromPrompt(
  apiKey: string,
  prompt: string,
  size: string,
  quality: string,
  n: number,
): Promise<{ ok: true; data: OpenAIImageResponse } | { ok: false; error: string }> {
  const resp = await fetch(OPENAI_IMAGE_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: OPENAI_IMAGE_MODEL, prompt, n, size, quality }),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    logger.error(`[generateImage] OpenAI error ${resp.status}: ${errText.slice(0, 500)}`);
    return { ok: false, error: parseOpenAIError(resp.status, errText) };
  }
  return { ok: true, data: (await resp.json()) as OpenAIImageResponse };
}

/**
 * Image-to-image via the edits endpoint — composites the product photo(s)
 * into the packaging. Reference images are fetched by URL and sent as
 * multipart/form-data.
 */
async function generateFromReferences(
  apiKey: string,
  prompt: string,
  size: string,
  quality: string,
  n: number,
  referenceImageUrls: string[],
): Promise<{ ok: true; data: OpenAIImageResponse } | { ok: false; error: string }> {
  const form = new FormData();
  form.append("model", OPENAI_IMAGE_MODEL);
  form.append("prompt", prompt);
  form.append("n", String(n));
  if (size !== "auto") form.append("size", size);
  if (quality !== "auto") form.append("quality", quality);

  for (const url of referenceImageUrls) {
    const imgResp = await fetch(url);
    if (!imgResp.ok) {
      return { ok: false, error: `Failed to fetch reference image: ${url} (HTTP ${imgResp.status})` };
    }
    const buf = await imgResp.arrayBuffer();
    const contentType = imgResp.headers.get("content-type") || "image/png";
    // gpt-image models accept multiple reference images via repeated `image[]`.
    form.append("image[]", new Blob([buf], { type: contentType }), "reference.png");
  }

  const resp = await fetch(OPENAI_IMAGE_EDIT_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!resp.ok) {
    const errText = await resp.text();
    logger.error(`[generateImage] OpenAI edits error ${resp.status}: ${errText.slice(0, 500)}`);
    return { ok: false, error: parseOpenAIError(resp.status, errText) };
  }
  return { ok: true, data: (await resp.json()) as OpenAIImageResponse };
}

/**
 * Generate one or more images from a text prompt (optionally guided by
 * reference product photos) using OpenAI's official image model
 * (gpt-image-2 by default; configurable via OPENAI_IMAGE_MODEL). Returned
 * base64 data is persisted to disk and exposed as
 * URLs, so the chat transcript stays small and the frontend can display,
 * zoom, and download each result.
 */
export const generateImage = tool({
  description:
    "Generate one or more images from a text prompt using OpenAI's gpt-image-2 model. " +
    "Use this whenever the user asks to create, draw, generate, paint, design, " +
    "or illustrate an image, picture, photo, logo, icon, artwork, or product packaging. " +
    "Set `n` to 2 or 3 to offer the user several options at once. Pass " +
    "`referenceImageUrls` (e.g. an uploaded product photo) to composite real " +
    "objects into the result via image-to-image. " +
    "The generated images are shown directly to the user, so you do not need to " +
    "describe them in detail afterwards — a short confirmation is enough.",
  inputSchema: z.object({
    prompt: z
      .string()
      .min(1)
      .describe(
        "A detailed description of the image to generate. Be specific about " +
          "the subject, style, colors, mood, composition, and — for packaging — " +
          "the exact text (product name / origin / selling points) and where it " +
          "should appear. May be written in any language.",
      ),
    n: z
      .number()
      .int()
      .min(1)
      .max(3)
      .optional()
      .describe("How many images to generate (1–3). Defaults to 1."),
    referenceImageUrls: z
      .array(z.string())
      .optional()
      .describe(
        "Optional URLs of reference images (e.g. an uploaded product photo). " +
          "When provided, image-to-image (edits) is used instead of text-to-image.",
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
  execute: async ({
    prompt,
    n = 1,
    referenceImageUrls,
    size = "1024x1024",
    quality = "auto",
  }) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return {
        success: false,
        error:
          "OPENAI_API_KEY is not configured on the server. Add it to packages/api-server/.env and restart.",
      };
    }

    const hasReferences = Array.isArray(referenceImageUrls) && referenceImageUrls.length > 0;

    // Print the exact prompt and reference images the agent is sending to
    // OpenAI, so it's easy to inspect what drives each generation.
    logger.info(
      `[generateImage] → OpenAI ${hasReferences ? "edits" : "generations"} ` +
        `(model=${OPENAI_IMAGE_MODEL}, n=${n}, size=${size}, quality=${quality})`,
    );
    logger.info(`[generateImage] prompt:\n${prompt}`);
    if (hasReferences) {
      logger.info(
        `[generateImage] referenceImageUrls (${referenceImageUrls!.length}):\n` +
          referenceImageUrls!.map((u, i) => `  [${i + 1}] ${u}`).join("\n"),
      );
    } else {
      logger.info("[generateImage] referenceImageUrls: (none)");
    }

    try {
      const result = hasReferences
        ? await generateFromReferences(apiKey, prompt, size, quality, n, referenceImageUrls!)
        : await generateFromPrompt(apiKey, prompt, size, quality, n);

      if (!result.ok) {
        return { success: false, error: result.error };
      }

      const items = result.data?.data ?? [];
      const withData = items.filter((it) => it?.b64_json);
      if (withData.length === 0) {
        return { success: false, error: "OpenAI returned no image data." };
      }

      const images = await Promise.all(
        withData.map(async (item) => {
          const { url, fileName } = await saveImageBase64(item.b64_json!, "png");
          return { url, fileName, revisedPrompt: item.revised_prompt };
        }),
      );

      logger.info(
        `[generateImage] saved ${images.length} image(s) (size=${size}, quality=${quality}, edits=${hasReferences})`,
      );

      return {
        success: true,
        images,
        // First-image fields kept at top level for backward compatibility with
        // the inline GeneratedImageCard renderer.
        url: images[0].url,
        fileName: images[0].fileName,
        revisedPrompt: images[0].revisedPrompt,
        prompt,
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
