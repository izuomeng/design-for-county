import type { ServerWebSocket } from "bun";
import {
  WSMessageType,
  parseWSMessage,
  createWSMessage,
  type FunctionSchema,
  type SkillSchema,
  type ToolResultResponse,
} from "oceanmcp-shared";
import { handleChatRequest } from "./routes/chat";
import { handleGenerateTitleRequest } from "./routes/generate-title";
import { IMAGE_DIR, IMAGE_ROUTE_PREFIX, saveImageBytes } from "./ai/tools/image-store";
import {
  REFERENCE_ROUTE_PREFIX,
  getReferenceImagePath,
} from "./ai/tools/reference-store";
import { join } from "node:path";
import { connectionManager } from "./ws/connection-manager";
import { initSkills, getSkillsContext } from "./ai/prompts";
import { loadSkillsFromZip } from "./ai/skills";
import { logger } from "./logger";

const PORT = Number(process.env.PORT) || 4001;

/**
 * Decode a URL path segment, returning null on malformed percent-encoding.
 *
 * Streaming clients can request truncated URLs (e.g. a percent sequence cut
 * mid-byte like `%E6%A1`), which makes `decodeURIComponent` throw a URIError.
 * We treat those as bad requests instead of letting the handler blow up.
 */
function safeDecodePathSegment(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

// ── Initialize the skills system before starting the server ──────────────────
// Skills are discovered from configured directories (e.g. packages/api-server/skills/).
// This must complete before the server starts accepting chat requests, so the
// system prompt includes the skills catalog and the loadSkill tool is available.
await initSkills();

const server = Bun.serve<{ connectionId: string }>({
  port: PORT,
  idleTimeout: 255,

  async fetch(req, server) {
    const url = new URL(req.url);

    // ── CORS preflight ──────────────────────────────────────────────────
    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    // ── Health check ────────────────────────────────────────────────────
    if (url.pathname === "/health") {
      return new Response("OK", { status: 200 });
    }

    // ── Generated images (static) ───────────────────────────────────────
    if (req.method === "GET" && url.pathname.startsWith(IMAGE_ROUTE_PREFIX)) {
      const fileName = safeDecodePathSegment(
        url.pathname.slice(IMAGE_ROUTE_PREFIX.length),
      );
      // Guard against malformed encoding + path traversal — bare filename only.
      if (!fileName || fileName.includes("/") || fileName.includes("..")) {
        return new Response("Bad Request", { status: 400 });
      }
      const file = Bun.file(join(IMAGE_DIR, fileName));
      if (!(await file.exists())) {
        return new Response("Not Found", { status: 404 });
      }
      return new Response(file, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    }

    // ── Reference library images (static) ───────────────────────────────
    // Serves the county packaging-reference effect images (assets/images/),
    // which the searchReferences tool surfaces as candidate URLs.
    if (req.method === "GET" && url.pathname.startsWith(REFERENCE_ROUTE_PREFIX)) {
      const fileName = safeDecodePathSegment(
        url.pathname.slice(REFERENCE_ROUTE_PREFIX.length),
      );
      // Guard against malformed encoding + path traversal — bare filename only.
      if (!fileName || fileName.includes("/") || fileName.includes("..")) {
        return new Response("Bad Request", { status: 400 });
      }
      const path = getReferenceImagePath(fileName);
      if (!path) {
        return new Response("Not Found", { status: 404 });
      }
      const file = Bun.file(path);
      if (!(await file.exists())) {
        return new Response("Not Found", { status: 404 });
      }
      return new Response(file, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    }

    // ── File upload (product photos) ────────────────────────────────────
    // Stores uploaded images and returns public URLs. The frontend's
    // registered uploader posts here; the URLs are then usable as
    // generateImage `referenceImageUrls` (image-to-image).
    if (url.pathname === "/api/upload" && req.method === "POST") {
      try {
        const form = await req.formData();
        const files = form.getAll("files").filter((f): f is File => f instanceof File);
        const saved = [];
        for (const file of files) {
          const name = file.name || "upload.png";
          const ext = (name.includes(".") ? name.split(".").pop() : "png") || "png";
          const bytes = new Uint8Array(await file.arrayBuffer());
          const { url: fileUrl } = await saveImageBytes(bytes, ext);
          saved.push({ url: fileUrl, name, size: file.size, type: file.type });
        }
        return Response.json(
          { files: saved },
          { headers: { "Access-Control-Allow-Origin": "*" } },
        );
      } catch (err) {
        logger.error("[upload] failed:", err);
        return Response.json(
          { error: err instanceof Error ? err.message : String(err) },
          { status: 500, headers: { "Access-Control-Allow-Origin": "*" } },
        );
      }
    }

    // ── Chat API ────────────────────────────────────────────────────────
    if (url.pathname === "/api/chat" && req.method === "POST") {
      const response = await handleChatRequest(req);
      response.headers.set("Access-Control-Allow-Origin", "*");
      return response;
    }

    // ── Generate title API ───────────────────────────────────────────
    if (url.pathname === "/api/generate-title" && req.method === "POST") {
      const response = await handleGenerateTitleRequest(req);
      response.headers.set("Access-Control-Allow-Origin", "*");
      return response;
    }
    // ── WebSocket upgrade ───────────────────────────────────────────────
    if (url.pathname === "/connect") {
      const connectionId = crypto.randomUUID();
      const upgraded = server.upgrade(req, { data: { connectionId } });
      if (!upgraded) {
        return new Response("WebSocket upgrade failed", { status: 400 });
      }
      return undefined;
    }

    return new Response("Not Found", { status: 404 });
  },

  websocket: {
    open(ws: ServerWebSocket<{ connectionId: string }>) {
      const { connectionId } = ws.data;
      connectionManager.addConnection(connectionId, ws);
      ws.send(
        createWSMessage({
          type: WSMessageType.CAPABILITIES_REGISTERED,
          payload: { connectionId },
        }),
      );
      logger.info(`[WS] Client connected: ${connectionId}`);
    },

    message(
      ws: ServerWebSocket<{ connectionId: string }>,
      message: string | Buffer,
    ) {
      const data = typeof message === "string" ? message : message.toString();
      try {
        const msg = parseWSMessage(data);

        switch (msg.type) {
          case WSMessageType.TOOL_RESULT:
            connectionManager.resolveToolResult(
              msg.payload as ToolResultResponse,
            );
            break;

          case WSMessageType.REGISTER_CAPABILITIES:
            connectionManager.registerTools(
              ws.data.connectionId,
              (
                msg.payload as {
                  tools: FunctionSchema[];
                  skills: SkillSchema[];
                }
              ).tools,
            );
            connectionManager.registerSkills(
              ws.data.connectionId,
              (
                msg.payload as {
                  tools: FunctionSchema[];
                  skills: SkillSchema[];
                }
              ).skills,
            );
            logger.info(
              `[WS] Capabilities registered for ${ws.data.connectionId}: ` +
                `${(msg.payload as { tools: FunctionSchema[] }).tools.length} tool(s), ` +
                `${(msg.payload as { skills: SkillSchema[] }).skills.length} skill(s)`,
            );
            break;

          case WSMessageType.PING:
            ws.send(createWSMessage({ type: WSMessageType.PONG }));
            break;

          case WSMessageType.REGISTER_SKILL_ZIP: {
            const { requestId, url } = msg.payload as {
              requestId: string;
              url: string;
            };
            logger.info(
              `[WS] Zip skill registration requested: ${url} (${requestId})`,
            );

            // Async: download, extract, discover, and register — then respond
            const { sandbox } = getSkillsContext();
            loadSkillsFromZip(sandbox, url)
              .then(({ skills: newSkills, extractDir }) => {
                // Store per-connection, keyed by URL (replaces previous registration for same URL)
                connectionManager.registerZipSkills(
                  ws.data.connectionId,
                  url,
                  newSkills,
                  extractDir,
                );

                const skillMeta = newSkills.map((s) => ({
                  name: s.name,
                  description: s.description,
                  path: s.path,
                }));

                ws.send(
                  createWSMessage({
                    type: WSMessageType.SKILL_ZIP_REGISTERED,
                    payload: { requestId, skills: skillMeta },
                  }),
                );
                logger.info(
                  `[WS] Zip skill(s) registered for ${ws.data.connectionId}: ${newSkills.map((s) => s.name).join(", ") || "(none)"}`,
                );
              })
              .catch((err) => {
                const error =
                  err instanceof Error ? err.message : String(err);
                ws.send(
                  createWSMessage({
                    type: WSMessageType.SKILL_ZIP_ERROR,
                    payload: { requestId, error },
                  }),
                );
                logger.error(
                  `[WS] Zip skill registration failed: ${error}`,
                );
              });
            break;
          }
        }
      } catch (err) {
        logger.error("[WS] Failed to parse message:", err);
      }
    },

    close(ws: ServerWebSocket<{ connectionId: string }>) {
      connectionManager.removeConnection(ws.data.connectionId);
      logger.info(`[WS] Client disconnected: ${ws.data.connectionId}`);
    },
  },
});

logger.info(
  `OceanMCP API Server running on http://localhost:${server.port}`,
);

// ── Env sanity check ─────────────────────────────────────────────────────────
// Confirms the .env file was actually loaded (Bun auto-loads .env from cwd).
// Secrets are redacted to a length-only hint so they're safe to print.
const redact = (v: string | undefined) =>
  v ? `set(${v.length} chars)` : "MISSING";
logger.info(
  "[env] " +
    [
      `LLM_PROVIDER=${process.env.LLM_PROVIDER ?? "MISSING"}`,
      `LLM_BASE_URL=${process.env.LLM_BASE_URL ?? "MISSING"}`,
      `LLM_MODEL=${process.env.LLM_MODEL ?? "MISSING"}`,
      `LLM_API_KEY=${redact(process.env.LLM_API_KEY)}`,
      `OPENAI_API_KEY=${redact(process.env.OPENAI_API_KEY)}`,
    ].join(" "),
);
