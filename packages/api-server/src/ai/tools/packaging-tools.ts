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
    "user pick ONE OR SEVERAL by looking at pictures (no design jargon). Renders a " +
    "multi-select image grid in the right-hand design canvas. Call this right after " +
    "the category is known. The user may also pick 'let you decide'. Returns " +
    "{ styleId, label, promptAnchor, styles: [{ styleId, label, promptAnchor }, ...] } " +
    "where `styles` lists every pick in selection order and the top-level fields " +
    "mirror the FIRST pick (the 主参考 that drives field backfill). For 'let you " +
    "decide' the output is { styleId: 'auto', styles: [] }.",
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
 *
 * Besides the basic fields, it carries the structured design dimensions that
 * the collection flow gathers (see SKILL.md「采集字段清单」): the 3 free-text
 * fields (productName / spec / mainVisual) and the 8 preset fields
 * (visualStyle / visualType / fontTone / layout / logoPos / structure /
 * mainColor / packForm), plus the context-bound culturalAnchor. The summary
 * card renders these so the user can review the full brief before generating,
 * and they map 1:1 to the SKILL.md「Prompt 组装」template.
 */
export const confirmBrief = tool({
  description:
    "Show a design-brief summary card (product / spec / style / layout / color / " +
    "main-visual / selling points) with a prominent '🎨 开始生成 · 一次出 2~3 张' " +
    "button in the right canvas. Call this AFTER all necessary info is collected " +
    "and BEFORE generateImage. Pass every design field you gathered (the 3 " +
    "free-text fields and the 8 preset fields) so the card shows the full brief. " +
    "Do NOT auto-generate — wait for the user to press the button. " +
    "Returns { confirmed: true } once the user starts generation.",
  inputSchema: z.object({
    category: z.string().describe("品类大类，如 干货农副 / 即食零食 / 蜂蜜."),
    productName: z.string().describe("产品名 — printed as the main title."),
    spec: z.string().optional().describe("净含量 / net weight, hand-filled number, e.g. 250g / 500g / 1kg / 500ml."),
    flavor: z.string().optional().describe("口味 / flavor (snacks only), e.g. 原味 / 麻辣 / 五香."),
    origin: z.string().optional().describe("产地 / origin (county)."),
    // ── 8 preset design dimensions (values from SKILL.md「预设选项库」) ──
    visualStyle: z
      .string()
      .optional()
      .describe("视觉风格 label, e.g. 民俗绘画. From selectStyle."),
    visualType: z
      .string()
      .optional()
      .describe("主视觉类型: 插画 / 摄影实拍 / 文字图形."),
    fontTone: z
      .string()
      .optional()
      .describe("字体调性, e.g. 厚重黑体."),
    layout: z
      .string()
      .optional()
      .describe("版式骨架: 上下分区型 / 居中型 / 满铺图."),
    logoPos: z
      .string()
      .optional()
      .describe("Logo 位置, e.g. 顶部右."),
    structure: z
      .array(z.string())
      .optional()
      .describe("结构惯例 (multi-select): 开窗 / 腰封 / 全包."),
    mainColor: z
      .string()
      .optional()
      .describe("主色, e.g. 黄色系."),
    packForm: z
      .string()
      .optional()
      .describe(
        "包装形态 (one of: 袋装 / 普通盒装 / 礼盒装 / 瓶装 / 罐装 / 天然材质袋 / 箱装).",
      ),
    // ── core free-text field ──
    mainVisual: z
      .string()
      .optional()
      .describe("主视觉描述 — the scene/illustration description."),
    // ── context-bound ──
    culturalAnchor: z
      .string()
      .optional()
      .describe("文化锚点, e.g. 宜君农民画 (bound to the county)."),
    sellingPoints: z
      .array(z.string())
      .optional()
      .describe("Selling points to feature (optional)."),
    productPhotoUrls: z
      .array(z.string())
      .optional()
      .describe(
        "Uploaded product photo / reference image URLs (for image-to-image generation).",
      ),
  }),
});
