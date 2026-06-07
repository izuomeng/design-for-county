import { tool } from "ai";
import { z } from "zod";

/**
 * Packaging-design canvas tools.
 *
 * Both are **client-side tools** (no `execute`): the agent calls them to drive
 * the right-hand design canvas, and the frontend returns the user's choice via
 * `addToolResult` — the same pattern as `askUser`.
 */

const styleOptionSchema = z.object({
  id: z.string().describe("Stable id returned when the user picks this style."),
  label: z.string().describe("Short caption shown under the image."),
  thumbnailUrl: z.string().describe("URL of the style reference thumbnail."),
  promptAnchor: z
    .string()
    .describe(
      "Style prompt fragment to inject into generateImage when this style is " +
        "chosen — keeps the output on-brand (寻美 风格锚).",
    ),
});

/**
 * `selectStyle` — show packaging style reference images for a category and let
 * the user pick one. Rendered as an image grid in the design canvas, with a
 * built-in "都行，你帮我选" default option.
 */
export const selectStyle = tool({
  description:
    "Present packaging-style reference images for a product category and let the " +
    "user pick one by looking at pictures (no design jargon). Renders an image " +
    "grid in the right-hand design canvas. Call this right after the category is " +
    "known. The user may also pick 'let you decide'. Returns { styleId, promptAnchor }.",
  inputSchema: z.object({
    category: z.string().describe("Product category, e.g. 蜂蜜 / 茶 / 果干."),
    options: z
      .array(styleOptionSchema)
      .min(1)
      .describe("Style options to show as an image grid (typically 3–6)."),
  }),
});

/**
 * `confirmBrief` — show the design brief summary card plus a prominent
 * "🎨 开始生成" button. Call this AFTER all info is collected and BEFORE
 * `generateImage`. The agent must NOT auto-generate; generation is an explicit,
 * user-initiated action (PRD §6.2).
 */
export const confirmBrief = tool({
  description:
    "Show a design-brief summary card (style / product / origin / selling points) " +
    "with a prominent '🎨 开始生成 · 一次出 2~3 张' button in the right canvas. " +
    "Call this AFTER all necessary info is collected and BEFORE generateImage. " +
    "Do NOT auto-generate — wait for the user to press the button. " +
    "Returns { confirmed: true } once the user starts generation.",
  inputSchema: z.object({
    category: z.string(),
    style: z.string().optional().describe("Chosen style label."),
    productName: z.string().describe("Product name to print on the packaging."),
    origin: z.string().optional().describe("产地 / origin."),
    sellingPoints: z
      .array(z.string())
      .optional()
      .describe("Selling points to feature."),
    productPhotoUrls: z
      .array(z.string())
      .optional()
      .describe("Uploaded product photo URLs (for image-to-image generation)."),
  }),
});
