import { mkdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * Directory where generated images are persisted on disk.
 * Served back to the frontend via the static route in index.ts.
 */
export const IMAGE_DIR = join(process.cwd(), ".generated-images");

/** URL path prefix under which generated images are served. */
export const IMAGE_ROUTE_PREFIX = "/generated-images/";

/**
 * Public base URL the frontend uses to reach this server.
 * Defaults to localhost:PORT for local development; override with
 * IMAGE_PUBLIC_BASE_URL when the server is reachable at another origin.
 */
export function getPublicBaseUrl(): string {
  const explicit = process.env.IMAGE_PUBLIC_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const port = Number(process.env.PORT) || 4001;
  return `http://localhost:${port}`;
}

let dirEnsured = false;
async function ensureDir(): Promise<void> {
  if (dirEnsured) return;
  await mkdir(IMAGE_DIR, { recursive: true });
  dirEnsured = true;
}

export interface SavedImage {
  fileName: string;
  url: string;
  path: string;
}

/**
 * Persist raw image bytes to {@link IMAGE_DIR}.
 * Returns the on-disk path and the public URL the frontend can load.
 */
export async function saveImageBytes(
  bytes: Uint8Array | ArrayBuffer | Buffer,
  ext = "png",
): Promise<SavedImage> {
  await ensureDir();
  const safeExt = /^[a-z0-9]{1,8}$/i.test(ext) ? ext.toLowerCase() : "png";
  const fileName = `${crypto.randomUUID()}.${safeExt}`;
  const path = join(IMAGE_DIR, fileName);
  await Bun.write(path, bytes as any);
  const url = `${getPublicBaseUrl()}${IMAGE_ROUTE_PREFIX}${fileName}`;
  return { fileName, url, path };
}

/**
 * Decode a base64-encoded image and persist it to {@link IMAGE_DIR}.
 * Returns the on-disk path and the public URL the frontend can load.
 */
export async function saveImageBase64(
  base64: string,
  ext = "png",
): Promise<SavedImage> {
  return saveImageBytes(Buffer.from(base64, "base64"), ext);
}
