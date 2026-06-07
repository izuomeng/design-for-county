import React, { useState, useSyncExternalStore } from "react";
import type { StyleOption, GenerationResult } from "oceanmcp-shared";
import { sdkConfig } from "../runtime/sdk-config";
import { studioStore } from "../studio/studio-store";
import { downloadImage, ImageLightbox } from "./GeneratedImageCard";

const zh = () => sdkConfig.locale === "zh-CN";
const tt = (cn: string, en: string) => (zh() ? cn : en);

/** Placeholder showcase designs for the initial welcome state (#1). */
const SAMPLE_DESIGNS = [
  "https://placehold.co/400x560/F4C430/4A2C00?text=Honey",
  "https://placehold.co/400x560/8C1F28/F5E6C8?text=Tea",
  "https://placehold.co/400x560/FF7F50/4A1C00?text=Fruit",
  "https://placehold.co/400x560/3A5A40/EAF3E0?text=Rice",
  "https://placehold.co/400x560/2F4F4F/F5F5DC?text=Nuts",
  "https://placehold.co/400x560/D2B48C/3A2410?text=Honey+2",
  "https://placehold.co/400x560/6B4226/F5E6C8?text=Tea+2",
  "https://placehold.co/400x560/C25B3A/FFE8D6?text=Fruit+2",
];

// ─── Derived canvas state ──────────────────────────────────────────────────

interface PendingStyle {
  toolCallId: string;
  category?: string;
  options: StyleOption[];
}
interface SelectedStyle {
  label?: string;
  thumbnailUrl?: string;
  auto: boolean;
}
interface CanvasState {
  pendingStyle?: PendingStyle;
  pendingBriefId?: string;
  generating: boolean;
  results?: GenerationResult[];
  selectedStyle?: SelectedStyle;
}

function isAnswered(part: any): boolean {
  return part?.state === "output-available" || part?.output != null;
}

/** Walk the message stream and derive what the canvas should show. */
function deriveCanvasState(messages: any[]): CanvasState {
  let pendingStyle: PendingStyle | undefined;
  let pendingBriefId: string | undefined;
  let generating = false;
  let results: GenerationResult[] | undefined;
  let selectedStyle: SelectedStyle | undefined;

  for (const msg of messages ?? []) {
    if (!Array.isArray(msg?.parts)) continue;
    for (const part of msg.parts) {
      const type = part?.type;
      if (type === "tool-selectStyle") {
        const options: StyleOption[] = Array.isArray(part.input?.options)
          ? part.input.options
          : [];
        if (!isAnswered(part)) {
          pendingStyle = { toolCallId: part.toolCallId, category: part.input?.category, options };
        } else {
          if (pendingStyle?.toolCallId === part.toolCallId) pendingStyle = undefined;
          const out = part.output ?? {};
          const styleId = out.styleId;
          const match = options.find((o) => o.id === styleId);
          selectedStyle = {
            label: out.label || match?.label,
            thumbnailUrl: match?.thumbnailUrl,
            auto: styleId === "auto" || !match,
          };
        }
      } else if (type === "tool-confirmBrief") {
        pendingBriefId = !isAnswered(part) ? part.toolCallId : undefined;
      } else if (type === "tool-generateImage") {
        const settled =
          part.state === "output-available" || part.state === "output-error";
        if (!settled) {
          generating = true;
          results = undefined;
        } else {
          generating = false;
          const out = part.output;
          if (out?.success && Array.isArray(out.images) && out.images.length > 0) {
            results = out.images as GenerationResult[];
          } else if (out?.url) {
            results = [{ url: out.url, fileName: out.fileName ?? "image.png" }];
          }
        }
      }
    }
  }

  return { pendingStyle, pendingBriefId, generating, results, selectedStyle };
}

// ─── Shell ─────────────────────────────────────────────────────────────────

function CanvasShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full w-full overflow-y-auto ocean-scrollbar bg-surface-secondary p-5">
      {children}
    </div>
  );
}

function CanvasTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-base font-semibold text-text-primary mb-4">{children}</h2>;
}

// ─── #1 Welcome — showcase carousel of sample designs ───────────────────────

function Welcome() {
  return (
    <CanvasShell>
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-text-primary mb-1">
          {tt("寻美 · AI 包装小助手", "Xunmei · AI packaging assistant")}
        </h2>
        <p className="text-sm text-text-secondary">
          {tt(
            "看看大家做出来的包装，在左侧告诉我你卖什么，几步就能出图。",
            "Browse sample packaging — tell me what you sell on the left to start.",
          )}
        </p>
      </div>

      {/* Carousel row 1 */}
      <div className="flex gap-3 overflow-x-auto ocean-scrollbar pb-3 snap-x">
        {SAMPLE_DESIGNS.map((src) => (
          <div
            key={src}
            className="shrink-0 w-40 snap-start rounded-xl border border-border bg-surface overflow-hidden shadow-card"
          >
            <img src={src} alt="sample" loading="lazy" className="block w-full h-auto" />
          </div>
        ))}
      </div>

      {/* Carousel row 2 (reversed for visual variety) */}
      <div className="flex gap-3 overflow-x-auto ocean-scrollbar pt-1 snap-x">
        {[...SAMPLE_DESIGNS].reverse().map((src) => (
          <div
            key={"r-" + src}
            className="shrink-0 w-40 snap-start rounded-xl border border-border bg-surface overflow-hidden shadow-card"
          >
            <img src={src} alt="sample" loading="lazy" className="block w-full h-auto" />
          </div>
        ))}
      </div>

      <p className="mt-5 text-center text-xs text-text-tertiary">
        {tt("以上为示例效果图，仅供参考", "Samples shown for reference only")}
      </p>
    </CanvasShell>
  );
}

// ─── Style grid ──────────────────────────────────────────────────────────────

function StyleGrid({
  pending,
  onPick,
  disabled,
}: {
  pending: PendingStyle;
  onPick: (output: Record<string, unknown>) => void;
  disabled: boolean;
}) {
  return (
    <CanvasShell>
      <CanvasTitle>
        {tt("挑一个你喜欢的风格", "Pick a style you like")}
        {pending.category ? ` · ${pending.category}` : ""}
      </CanvasTitle>
      <div className="grid grid-cols-2 gap-3">
        {pending.options.map((opt) => (
          <button
            key={opt.id}
            disabled={disabled}
            onClick={() =>
              onPick({ styleId: opt.id, label: opt.label, promptAnchor: opt.promptAnchor })
            }
            className="group text-left rounded-xl border border-border bg-surface overflow-hidden shadow-card hover:border-ocean-400 hover:shadow-lg transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div className="aspect-[3/4] w-full bg-surface-tertiary overflow-hidden">
              <img
                src={opt.thumbnailUrl}
                alt={opt.label}
                loading="lazy"
                className="block w-full h-full object-cover group-hover:scale-[1.03] transition-transform"
              />
            </div>
            <div className="px-3 py-2 text-sm font-medium text-text-primary truncate">
              {opt.label}
            </div>
          </button>
        ))}
      </div>
      <button
        disabled={disabled}
        onClick={() => onPick({ styleId: "auto", label: tt("你帮我选", "You decide"), promptAnchor: "" })}
        className="mt-4 w-full py-2.5 rounded-xl border border-dashed border-border text-sm font-medium text-text-secondary hover:bg-surface-tertiary transition-colors cursor-pointer disabled:opacity-50"
      >
        {tt("都行，你帮我选 ✨", "Any is fine — you decide ✨")}
      </button>
    </CanvasShell>
  );
}

// ─── #2 Selected-style state (shown while collecting info) ───────────────────

function SelectedStyleView({ selected }: { selected: SelectedStyle }) {
  return (
    <CanvasShell>
      <CanvasTitle>{tt("已选风格", "Selected style")}</CanvasTitle>
      <div className="rounded-2xl border-2 border-ocean-400 bg-surface overflow-hidden shadow-card max-w-xs mx-auto">
        {selected.thumbnailUrl ? (
          <img src={selected.thumbnailUrl} alt={selected.label} className="block w-full h-auto" />
        ) : (
          <div className="aspect-[3/4] flex items-center justify-center text-5xl bg-surface-tertiary">
            ✨
          </div>
        )}
        <div className="px-4 py-3 flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-ocean-500 text-white text-xs">
            ✓
          </span>
          <span className="text-sm font-semibold text-text-primary">
            {selected.auto ? tt("由 AI 为你挑选风格", "AI-picked style") : selected.label}
          </span>
        </div>
      </div>
      <p className="mt-5 text-center text-sm text-text-secondary">
        {tt("继续在左侧补充产品信息 →", "Continue filling product info on the left →")}
      </p>
    </CanvasShell>
  );
}

// ─── Brief confirmation ──────────────────────────────────────────────────────

function BriefCard({
  briefInput,
  onConfirm,
  disabled,
}: {
  briefInput: any;
  onConfirm: () => void;
  disabled: boolean;
}) {
  const b = briefInput ?? {};
  const points: string[] = Array.isArray(b.sellingPoints)
    ? b.sellingPoints
    : typeof b.sellingPoints === "string" && b.sellingPoints
      ? [b.sellingPoints]
      : [];
  const structure: string[] = Array.isArray(b.structure)
    ? b.structure
    : typeof b.structure === "string" && b.structure
      ? [b.structure]
      : [];
  // `visualStyle` is the current field name; `style` kept for backward compat.
  const visualStyle = b.visualStyle ?? b.style;
  const row = (label: string, value?: React.ReactNode) =>
    value ? (
      <div className="flex gap-3 py-2 border-b border-border last:border-0">
        <span className="w-16 shrink-0 text-xs text-text-tertiary">{label}</span>
        <span className="text-sm text-text-primary break-words">{value}</span>
      </div>
    ) : null;

  return (
    <CanvasShell>
      <CanvasTitle>{tt("确认信息 · 准备生图", "Confirm · ready to generate")}</CanvasTitle>
      <div className="rounded-xl border border-border bg-surface shadow-card px-4 py-2">
        {row(tt("品类", "Category"), b.category)}
        {row(tt("产品名", "Product"), b.productName)}
        {row(tt("规格", "Spec"), b.spec)}
        {row(tt("产地", "Origin"), b.origin)}
        {row(tt("文化锚点", "Culture"), b.culturalAnchor)}
        {row(tt("视觉风格", "Style"), visualStyle)}
        {row(tt("主视觉", "Visual"), b.visualType)}
        {row(tt("字体", "Font"), b.fontTone)}
        {row(tt("版式", "Layout"), b.layout)}
        {row(tt("Logo", "Logo"), b.logoPos)}
        {row(tt("结构", "Structure"), structure.length ? structure.join(" · ") : undefined)}
        {row(tt("主色", "Color"), b.mainColor)}
        {row(tt("包装", "Pack"), b.packForm)}
        {row(tt("画面", "Scene"), b.mainVisual)}
        {row(tt("卖点", "Points"), points.length ? points.join(" · ") : undefined)}
        {Array.isArray(b.productPhotoUrls) && b.productPhotoUrls.length ? (
          <div className="flex gap-2 py-2">
            {b.productPhotoUrls.map((u: string) => (
              <img key={u} src={u} alt="product" className="w-14 h-14 rounded-lg object-cover border border-border" />
            ))}
          </div>
        ) : null}
      </div>
      <button
        disabled={disabled}
        onClick={onConfirm}
        className="mt-5 w-full py-3 rounded-xl bg-ocean-500 hover:bg-ocean-600 text-white text-sm font-semibold shadow-card transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {tt("🎨 开始生成 · 一次出 2~3 张", "🎨 Start generating · 2–3 options")}
      </button>
      <p className="mt-2 text-center text-xs text-text-tertiary">
        {tt("约几秒返回，文字以实际生成为准", "Takes a few seconds; text shown as generated")}
      </p>
    </CanvasShell>
  );
}

// ─── #5 Generating loading ───────────────────────────────────────────────────

function Loading() {
  const steps = [
    tt("调用生图 API", "Calling image API"),
    tt("生成画面层", "Rendering artwork"),
    tt("套清晰文字", "Adding clear text"),
  ];
  return (
    <CanvasShell>
      <div className="h-full flex flex-col items-center justify-center gap-4 py-20">
        <div
          className="inline-block w-9 h-9 border-[3px] border-ocean-500 border-t-transparent rounded-full"
          style={{ animation: "ocean-spin 0.8s linear infinite" }}
        />
        <p className="text-sm font-medium text-text-secondary ocean-tool-inline-text-shimmer">
          {steps.join(" → ")}…
        </p>
      </div>
    </CanvasShell>
  );
}

// ─── #6/#7/#8 Results gallery — display only, click to continue ──────────────

function Gallery({
  results,
  onSelect,
  disabled,
}: {
  results: GenerationResult[];
  onSelect: (r: GenerationResult) => void;
  disabled: boolean;
}) {
  const [zoom, setZoom] = useState<GenerationResult | null>(null);
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);

  const select = (r: GenerationResult) => {
    if (disabled) return;
    setSelectedUrl(r.url);
    onSelect(r);
  };

  return (
    <CanvasShell>
      <CanvasTitle>{tt("生成结果 · 点选一张继续", "Results · tap one to continue")}</CanvasTitle>
      <div className={`grid gap-3 ${results.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
        {results.map((r, i) => {
          const isSel = selectedUrl === r.url;
          return (
            <div
              key={r.fileName || i}
              className={`rounded-xl bg-surface overflow-hidden shadow-card transition-all ${
                isSel ? "ring-2 ring-ocean-500 border-2 border-ocean-500" : "border border-border"
              }`}
            >
              <button
                onClick={() => select(r)}
                disabled={disabled}
                className="relative block w-full group cursor-pointer disabled:cursor-not-allowed"
                title={tt("选这张，让 AI 基于它继续", "Pick this — continue from it")}
              >
                <img src={r.url} alt={r.fileName} loading="lazy" className="block w-full h-auto" />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
                {isSel && (
                  <span className="absolute top-2 right-2 inline-flex items-center justify-center w-6 h-6 rounded-full bg-ocean-500 text-white text-xs shadow">
                    ✓
                  </span>
                )}
              </button>
              <div className="flex items-center gap-3 px-2.5 py-2 border-t border-border">
                <button
                  onClick={() => setZoom(r)}
                  className="text-xs font-medium text-text-secondary hover:text-ocean-500 transition-colors cursor-pointer"
                >
                  {tt("放大", "Zoom")}
                </button>
                <button
                  onClick={() => downloadImage(r.url, r.fileName || `packaging-${i + 1}.png`)}
                  className="ml-auto text-xs font-medium text-ocean-500 hover:text-ocean-600 transition-colors cursor-pointer"
                >
                  {tt("下载", "Download")}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-4 text-center text-xs text-text-tertiary">
        {selectedUrl
          ? tt("已选中这张，AI 正在基于它继续…", "Selected — AI is continuing from it…")
          : tt("点选一张让 AI 基于它继续；想换风格/改细节请在左侧告诉我", "Tap one to continue; ask for changes on the left")}
      </p>

      {zoom && (
        <ImageLightbox
          url={zoom.url}
          fileName={zoom.fileName || "packaging.png"}
          onClose={() => setZoom(null)}
        />
      )}
    </CanvasShell>
  );
}

// ─── Main canvas ─────────────────────────────────────────────────────────────

export function DesignCanvas() {
  const runtime = useSyncExternalStore(
    studioStore.subscribe,
    studioStore.getSnapshot,
    studioStore.getSnapshot,
  );

  const { pendingStyle, pendingBriefId, generating, results, selectedStyle } =
    deriveCanvasState(runtime.messages);
  const busy = runtime.status === "streaming" || runtime.status === "submitted";

  // pendingBrief input lookup (kept out of derive to avoid threading the object)
  const briefInput = pendingBriefId
    ? findToolInput(runtime.messages, pendingBriefId)
    : null;

  if (pendingStyle) {
    return (
      <StyleGrid
        pending={pendingStyle}
        disabled={!runtime.addToolResult}
        onPick={(output) =>
          runtime.addToolResult?.({ toolCallId: pendingStyle.toolCallId, tool: "selectStyle", output })
        }
      />
    );
  }
  if (pendingBriefId) {
    return (
      <BriefCard
        briefInput={briefInput}
        disabled={!runtime.addToolResult}
        onConfirm={() =>
          runtime.addToolResult?.({ toolCallId: pendingBriefId, tool: "confirmBrief", output: { confirmed: true } })
        }
      />
    );
  }
  if (generating) return <Loading />;
  if (results && results.length > 0) {
    return (
      <Gallery
        results={results}
        disabled={busy || !runtime.sendMessage}
        onSelect={(r) =>
          runtime.sendMessage?.({
            text: tt(
              `我选这一张，请基于这张图的方向继续优化（参考图：${r.url}）`,
              `I pick this one — continue from it (reference: ${r.url})`,
            ),
          })
        }
      />
    );
  }
  if (selectedStyle) return <SelectedStyleView selected={selectedStyle} />;
  return <Welcome />;
}

/** Find a tool part's input by toolCallId across the message stream. */
function findToolInput(messages: any[], toolCallId: string): any {
  for (const msg of messages ?? []) {
    if (!Array.isArray(msg?.parts)) continue;
    for (const part of msg.parts) {
      if (part?.toolCallId === toolCallId) return part.input;
    }
  }
  return null;
}
