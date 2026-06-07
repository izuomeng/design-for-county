import React, { useEffect, useState } from "react";
import { TOOL_PART_STATE } from "oceanmcp-shared";
import { sdkConfig } from "../runtime/sdk-config";

interface GenImageOutput {
  success?: boolean;
  url?: string;
  fileName?: string;
  prompt?: string;
  revisedPrompt?: string;
  size?: string;
  quality?: string;
  model?: string;
  error?: string;
}

interface GeneratedImageCardProps {
  state: string;
  input?: { prompt?: string; size?: string; quality?: string };
  output?: GenImageOutput;
  errorText?: unknown;
  streamingActive?: boolean;
}

const zh = () => sdkConfig.locale === "zh-CN";
const tt = (cn: string, en: string) => (zh() ? cn : en);

async function downloadImage(url: string, fileName: string): Promise<void> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
  } catch {
    // Fall back to opening in a new tab if the blob download fails.
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

function DownloadIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function ZoomIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
      <line x1="11" y1="8" x2="11" y2="14" />
      <line x1="8" y1="11" x2="14" y2="11" />
    </svg>
  );
}

/** Fullscreen lightbox for zooming into the generated image. */
function ImageLightbox({
  url,
  fileName,
  onClose,
}: {
  url: string;
  fileName: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 2147483647 }}
      className="flex items-center justify-center bg-black/80 backdrop-blur-sm ocean-fade-in p-4"
      role="dialog"
      aria-modal="true"
    >
      <img
        src={url}
        alt={fileName}
        onClick={(e) => e.stopPropagation()}
        className="max-w-[95vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
      />

      {/* Toolbar */}
      <div
        className="absolute top-4 right-4 flex items-center gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={() => downloadImage(url, fileName)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/15 hover:bg-white/25 text-white text-sm font-medium transition-colors cursor-pointer backdrop-blur"
          title={tt("下载", "Download")}
        >
          <DownloadIcon />
          {tt("下载", "Download")}
        </button>
        <button
          onClick={onClose}
          className="flex items-center justify-center w-9 h-9 rounded-lg bg-white/15 hover:bg-white/25 text-white transition-colors cursor-pointer backdrop-blur"
          title={tt("关闭", "Close")}
          aria-label={tt("关闭", "Close")}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export function GeneratedImageCard({
  state,
  input,
  output,
  errorText,
}: GeneratedImageCardProps) {
  const [zoomed, setZoomed] = useState(false);
  const [imgError, setImgError] = useState(false);

  const isSettled =
    state === TOOL_PART_STATE.OUTPUT_AVAILABLE ||
    state === TOOL_PART_STATE.OUTPUT_ERROR;
  const promptText = output?.prompt || input?.prompt || "";

  // ── Error state ───────────────────────────────────────────────────────
  const errorMessage =
    state === TOOL_PART_STATE.OUTPUT_ERROR
      ? typeof errorText === "string"
        ? errorText
        : JSON.stringify(errorText)
      : output && output.success === false
        ? output.error
        : null;

  if (errorMessage) {
    return (
      <div className="my-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 ocean-fade-in">
        <p className="text-sm font-semibold text-red-600 mb-1">
          {tt("图片生成失败", "Image generation failed")}
        </p>
        <p className="text-xs text-red-500 break-words">{errorMessage}</p>
      </div>
    );
  }

  // ── Loading / generating state ────────────────────────────────────────
  if (!isSettled || !output?.url) {
    return (
      <div className="my-3 rounded-xl border border-border bg-surface overflow-hidden shadow-card ocean-fade-in">
        <div className="aspect-square w-full max-w-sm flex flex-col items-center justify-center gap-3 bg-surface-secondary">
          <div
            className="inline-block w-7 h-7 border-[3px] border-ocean-500 border-t-transparent rounded-full"
            style={{ animation: "ocean-spin 0.8s linear infinite" }}
          />
          <p className="text-sm text-text-secondary font-medium ocean-tool-inline-text-shimmer">
            {tt("正在生成图片…", "Generating image…")}
          </p>
        </div>
        {promptText && (
          <div className="px-4 py-2.5 border-t border-border">
            <p className="text-xs text-text-tertiary line-clamp-2">{promptText}</p>
          </div>
        )}
      </div>
    );
  }

  // ── Success state ─────────────────────────────────────────────────────
  const url = output.url;
  const fileName = output.fileName || "generated-image.png";

  if (imgError) {
    return (
      <div className="my-3 rounded-xl border border-border bg-surface px-4 py-3 ocean-fade-in">
        <p className="text-sm text-text-secondary mb-1">
          {tt("图片已生成，但无法加载预览。", "Image generated but the preview could not load.")}
        </p>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-ocean-500 hover:underline break-all"
        >
          {url}
        </a>
      </div>
    );
  }

  return (
    <>
      <div className="my-3 inline-block rounded-xl border border-border bg-surface overflow-hidden shadow-card ocean-fade-in max-w-md">
        {/* Image with zoom-on-click */}
        <div
          className="relative group cursor-zoom-in"
          onClick={() => setZoomed(true)}
        >
          <img
            src={url}
            alt={promptText || fileName}
            onError={() => setImgError(true)}
            className="block w-full h-auto"
            loading="lazy"
          />
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
            <span className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-black/55 text-white text-xs font-medium backdrop-blur">
              <ZoomIcon />
              {tt("点击放大", "Click to zoom")}
            </span>
          </div>
        </div>

        {/* Action bar */}
        <div className="flex items-center gap-2 px-3 py-2.5 border-t border-border">
          <button
            onClick={() => setZoomed(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-text-secondary hover:bg-surface-tertiary text-xs font-medium transition-colors cursor-pointer"
            title={tt("放大查看", "Zoom")}
          >
            <ZoomIcon />
            {tt("放大", "Zoom")}
          </button>
          <button
            onClick={() => downloadImage(url, fileName)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-text-secondary hover:bg-surface-tertiary text-xs font-medium transition-colors cursor-pointer"
            title={tt("下载图片", "Download")}
          >
            <DownloadIcon />
            {tt("下载", "Download")}
          </button>
          {output.size && (
            <span className="ml-auto text-[11px] text-text-tertiary">
              {output.size}
            </span>
          )}
        </div>
      </div>

      {zoomed && (
        <ImageLightbox
          url={url}
          fileName={fileName}
          onClose={() => setZoomed(false)}
        />
      )}
    </>
  );
}
