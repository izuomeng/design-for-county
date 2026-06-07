import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { getPublicBaseUrl } from "./image-store";
import { logger } from "../../logger";

/**
 * Reference-library store for the packaging-design flow.
 *
 * The dataset is the county packaging-design deconstruction sheet, converted to
 * CSV at `assets/乡村包装设计解构.csv` (repo root), with the per-row reference
 * images saved under `assets/images/`. The CSV's `参考图` column holds relative
 * paths (e.g. `assets/images/1-宜君核桃-宜君核桃.png`).
 *
 * The agent searches this library at runtime (see `searchReferences`) to find
 * candidate effect images for the user to pick from; the picked image is then
 * fed back into `generateImage` as an image-to-image reference, and its row
 * supplies the rest of the design fields (reverse-lookup), so the user no
 * longer has to answer every field by hand.
 *
 * This batch contains only 宜君 (Yijun county); future counties are added by
 * appending rows with a different `县域` value.
 */

/** CSV file name (relative to the dataset dir). */
const CSV_FILE = "乡村包装设计解构.csv";

/** URL path prefix under which reference images are served (see index.ts). */
export const REFERENCE_ROUTE_PREFIX = "/reference-images/";

/** One reference row, keyed by the CSV's Chinese headers. */
export interface ReferenceRow {
  id: string;
  productName: string;
  county: string;
  category: string;
  spec: string;
  flavor: string;
  /** Relative image paths from the CSV (`参考图` column). */
  imagePaths: string[];
  /** Public URLs the frontend can load (mapped from imagePaths). */
  imageUrls: string[];
  logoPos: string;
  visualType: string;
  visualStyle: string;
  packForm: string;
  layout: string;
  structure: string;
  mainColor: string;
  culturalAnchor: string;
  mainVisual: string;
  fontTone: string;
}

/**
 * Resolve the dataset directory (the `assets/` folder holding the CSV + images).
 *
 * Resolution order:
 *   1. `REFERENCE_DATA_DIR` env var (explicit override, e.g. for deployment).
 *   2. Walk up from this module's directory looking for `assets/<CSV_FILE>`.
 *
 * Using `import.meta.dir` makes this independent of the process cwd (the server
 * may be launched from the repo root or from `packages/api-server`).
 */
let cachedDir: string | null = null;
export function resolveDataDir(): string | null {
  if (cachedDir) return cachedDir;

  const explicit = process.env.REFERENCE_DATA_DIR?.trim();
  if (explicit && existsSync(join(explicit, CSV_FILE))) {
    cachedDir = explicit;
    return cachedDir;
  }

  let dir = import.meta.dir;
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, "assets");
    if (existsSync(join(candidate, CSV_FILE))) {
      cachedDir = candidate;
      return cachedDir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  logger.error(
    `[reference-store] Could not locate ${CSV_FILE}. Set REFERENCE_DATA_DIR to the assets/ dir.`,
  );
  return null;
}

/** Resolve the on-disk path of a reference image by bare file name. */
export function getReferenceImagePath(fileName: string): string | null {
  const dir = resolveDataDir();
  if (!dir) return null;
  return join(dir, "images", fileName);
}

/** Map a CSV `参考图` relative path to a public URL the frontend can load. */
function toImageUrl(relPath: string): string {
  const fileName = relPath.split("/").pop() ?? relPath;
  return `${getPublicBaseUrl()}${REFERENCE_ROUTE_PREFIX}${encodeURIComponent(fileName)}`;
}

/**
 * Minimal RFC-4180 CSV parser (handles quoted fields, escaped `""`, and commas
 * / newlines inside quotes). Returns rows as arrays of cell strings.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      // Skip blank trailing lines.
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else {
      cell += c;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    if (row.length > 1 || row[0] !== "") rows.push(row);
  }
  return rows;
}

let cachedRows: ReferenceRow[] | null = null;

/** Load and parse all reference rows from the CSV (cached). */
export async function loadReferences(): Promise<ReferenceRow[]> {
  if (cachedRows) return cachedRows;
  const dir = resolveDataDir();
  if (!dir) return [];

  const text = await Bun.file(join(dir, CSV_FILE)).text();
  const table = parseCsv(text);
  if (table.length < 2) return [];

  const headers = table[0];
  const idx = (name: string) => headers.indexOf(name);
  const col = {
    productName: idx("产品名"),
    id: idx("ID"),
    county: idx("县域"),
    category: idx("品类一级"),
    spec: idx("规格"),
    flavor: idx("口味"),
    image: idx("参考图"),
    logoPos: idx("Logo位置"),
    visualType: idx("主视觉类型"),
    visualStyle: idx("视觉风格"),
    packForm: idx("包装形态"),
    layout: idx("版式骨架"),
    structure: idx("结构惯例"),
    mainColor: idx("主色"),
    culturalAnchor: idx("文化锚点"),
    mainVisual: idx("主视觉描述"),
    fontTone: idx("字体调性"),
  };

  const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");

  const rows: ReferenceRow[] = [];
  for (let i = 1; i < table.length; i++) {
    const r = table[i];
    const productName = get(r, col.productName);
    if (!productName) continue;
    const imagePaths = get(r, col.image)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    rows.push({
      id: get(r, col.id),
      productName,
      county: get(r, col.county),
      category: get(r, col.category),
      spec: get(r, col.spec),
      flavor: get(r, col.flavor),
      imagePaths,
      imageUrls: imagePaths.map(toImageUrl),
      logoPos: get(r, col.logoPos),
      visualType: get(r, col.visualType),
      visualStyle: get(r, col.visualStyle),
      packForm: get(r, col.packForm),
      layout: get(r, col.layout),
      structure: get(r, col.structure),
      mainColor: get(r, col.mainColor),
      culturalAnchor: get(r, col.culturalAnchor),
      mainVisual: get(r, col.mainVisual),
      fontTone: get(r, col.fontTone),
    });
  }

  cachedRows = rows;
  logger.info(`[reference-store] loaded ${rows.length} reference rows from ${dir}`);
  return rows;
}
