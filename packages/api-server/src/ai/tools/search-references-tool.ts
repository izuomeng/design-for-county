import { tool } from "ai";
import { z } from "zod";
import { loadReferences, type ReferenceRow } from "./reference-store";
import { logger } from "../../logger";

/**
 * `searchReferences` — query the county packaging reference library.
 *
 * Drives the new packaging flow (see SKILL.md): after the 3 base questions
 * (product name / spec / pack form), the agent calls this to surface a handful
 * of real reference effect images. The agent then shows them via `selectStyle`
 * for the user to pick one; the picked row's design fields are reverse-looked-up
 * to fill the brief, and its image is fed to `generateImage` as an
 * image-to-image reference.
 *
 * Ranking signals (per the chosen dimensions): category (inferred from the
 * product name when not given), pack form, and spec tier. Matching is soft —
 * it always returns the best available rows rather than blocking on an exact
 * match.
 *
 * 宽松模式 (loose search): toggled by the `REFERENCE_LOOSE_SEARCH` env var. When
 * on, filters are relaxed so more rows surface — the county hard-filter is
 * dropped and the result cap is raised to return whatever the (currently small)
 * library can offer. Intended for the transition period while the asset library
 * is still being filled out; turn it off once there's enough coverage.
 */

/** Hard cap on results returned in 宽松模式, regardless of the requested limit. */
const LOOSE_MAX_RESULTS = 24;

/** Whether 宽松模式 (loose search) is enabled via `REFERENCE_LOOSE_SEARCH`. */
function isLooseMode(): boolean {
  const v = process.env.REFERENCE_LOOSE_SEARCH?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "on" || v === "yes";
}

/** Extract distinct CJK characters from a string. */
function cjkChars(s: string): Set<string> {
  const out = new Set<string>();
  for (const ch of s) if (/[一-鿿]/.test(ch)) out.add(ch);
  return out;
}

/** Count shared CJK characters between two strings. */
function sharedChars(a: string, b: string): number {
  const sb = cjkChars(b);
  let n = 0;
  for (const ch of cjkChars(a)) if (sb.has(ch)) n++;
  return n;
}

/**
 * Infer the category of a free-text product name by voting with the dataset:
 * rows whose product name shares ≥2 characters contribute their category.
 */
function inferCategory(productName: string, rows: ReferenceRow[]): string | null {
  if (!productName) return null;
  const votes = new Map<string, number>();
  for (const r of rows) {
    const overlap = sharedChars(productName, r.productName);
    if (overlap >= 2 && r.category) {
      votes.set(r.category, (votes.get(r.category) ?? 0) + overlap);
    }
  }
  let best: string | null = null;
  let bestScore = 0;
  for (const [cat, score] of votes) {
    if (score > bestScore) {
      best = cat;
      bestScore = score;
    }
  }
  return best;
}

/** Coarse spec tier so e.g. 250g and 300g match but 100g and 5kg don't. */
function specTier(spec: string): string {
  const s = spec.toLowerCase();
  if (/(礼盒|礼|盒|箱|提手)/.test(spec)) return "gift";
  const m = s.match(/([\d.]+)\s*(kg|g|ml|l)\b/);
  if (m) {
    let v = parseFloat(m[1]);
    const unit = m[2];
    if (unit === "kg" || unit === "l") v *= 1000;
    if (v < 200) return "small";
    if (v <= 800) return "medium";
    return "large";
  }
  if (/(个装|枚装|瓶)/.test(spec)) return "count";
  return "na";
}

export const searchReferences = tool({
  description:
    "Search the county packaging-design reference library for real effect " +
    "images to show the user. Call this AFTER collecting the base answers " +
    "(productName / spec; flavor for snacks). Pack form is asked AFTER style " +
    "selection, so usually omit it here. Ranks by category (inferred from the " +
    "product name when not given), pack form (if given), and spec tier, and always " +
    "returns the best available rows. Each result includes an `imageUrl` plus " +
    "every design field (visualStyle / layout / mainColor / culturalAnchor / " +
    "mainVisual / fontTone …). Show the results to the user with `selectStyle` " +
    "(thumbnailUrl = imageUrl, id = the row id); once they pick one, reverse-" +
    "look-up that row's fields from this result to fill `confirmBrief`, and pass " +
    "its imageUrl to `generateImage` as a `referenceImageUrls` entry.",
  inputSchema: z.object({
    productName: z
      .string()
      .optional()
      .describe("产品名 the user gave, e.g. 宜君核桃. Used to infer category and rank."),
    category: z
      .string()
      .optional()
      .describe("品类一级 if already known (e.g. 干货农副). Inferred from productName when omitted."),
    packForm: z
      .string()
      .optional()
      .describe(
        "包装形态 (one of: 袋装 / 普通盒装 / 礼盒装 / 瓶装 / 罐装 / 天然材质袋 / 箱装).",
      ),
    spec: z.string().optional().describe("净含量 / net weight, hand-filled, e.g. 250g / 500g / 1kg / 500ml."),
    county: z
      .string()
      .optional()
      .describe("县域 filter. Defaults to no filter (this batch is all 宜君)."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(12)
      .optional()
      .describe("Max results to return. Defaults to 6."),
  }),
  execute: async ({ productName, category, packForm, spec, county, limit = 6 }) => {
    try {
      let rows = await loadReferences();
      if (rows.length === 0) {
        return {
          success: false,
          error:
            "Reference library is empty or not found. Ensure assets/乡村包装设计解构.csv exists (or set REFERENCE_DATA_DIR).",
        };
      }

      const loose = isLooseMode();

      // In 宽松模式 we keep the county hard-filter off so refs from other
      // counties can still surface while the library is small; otherwise narrow
      // to the requested county when it yields any matches.
      if (county && !loose) {
        const filtered = rows.filter((r) => r.county === county);
        if (filtered.length > 0) rows = filtered;
      }

      const resolvedCategory = category || inferCategory(productName ?? "", rows) || undefined;
      const wantTier = spec ? specTier(spec) : null;

      const scored = rows.map((r) => {
        let score = 0;
        if (productName) score += sharedChars(productName, r.productName) * 3;
        if (resolvedCategory && r.category === resolvedCategory) score += 5;
        if (packForm && r.packForm === packForm) score += 4;
        if (wantTier && wantTier !== "na" && specTier(r.spec) === wantTier) score += 2;
        return { r, score };
      });

      scored.sort((a, b) => b.score - a.score);
      // 宽松模式: return as many rows as the library can offer (up to a sane cap)
      // rather than the usual small limit, so the user sees more candidates.
      const effectiveLimit = loose ? Math.max(limit, Math.min(rows.length, LOOSE_MAX_RESULTS)) : limit;
      const top = scored.slice(0, effectiveLimit).map(({ r, score }) => ({
        id: r.id,
        productName: r.productName,
        county: r.county,
        category: r.category,
        spec: r.spec,
        packForm: r.packForm,
        visualType: r.visualType,
        visualStyle: r.visualStyle,
        layout: r.layout,
        logoPos: r.logoPos,
        structure: r.structure,
        mainColor: r.mainColor,
        culturalAnchor: r.culturalAnchor,
        mainVisual: r.mainVisual,
        fontTone: r.fontTone,
        imageUrl: r.imageUrls[0] ?? "",
        imageUrls: r.imageUrls,
        matchScore: score,
      }));

      logger.info(
        `[searchReferences] productName=${productName} category=${resolvedCategory} packForm=${packForm} spec=${spec} loose=${loose} → ${top.length} results`,
      );

      return {
        success: true,
        resolvedCategory: resolvedCategory ?? null,
        count: top.length,
        references: top,
        note:
          "Show these to the user via selectStyle (thumbnailUrl=imageUrl, id=id, " +
          "label=productName). After they pick one, use that row's fields here to " +
          "fill confirmBrief, and pass its imageUrl to generateImage as referenceImageUrls.",
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[searchReferences] failed: ${message}`);
      return { success: false, error: message };
    }
  },
});
