import React, { useState, useSyncExternalStore } from "react";
import type { StyleOption, GenerationResult } from "oceanmcp-shared";
import { sdkConfig } from "../runtime/sdk-config";
import { API_URL } from "../config";
import { studioStore } from "../studio/studio-store";
import { selectedImageStore } from "../studio/selected-image-store";
import { downloadImage, ImageLightbox } from "./GeneratedImageCard";
import { SmartImage } from "./SmartImage";

const zh = () => sdkConfig.locale === "zh-CN";
const tt = (cn: string, en: string) => (zh() ? cn : en);

/**
 * Showcase designs for the initial welcome state (#1) — real 宜君 reference
 * packaging served by the api-server's `/reference-images/` route (see
 * reference-store.ts). File names come from assets/乡村包装设计解构.csv.
 */
const SAMPLE_DESIGN_FILES = [
  "1-宜君核桃-宜君核桃.png",
  "4-宜君荞面饸饹-宜君荞面饸饹(1kg长条袋).jpg",
  "5-宜君木耳-宜君木耳.png",
  "8-宜君老蜂蜜-宜君老蜂蜜.png",
  "9-宜君西瓜-宜君西瓜礼盒.png",
  "13-宜君手撕兔-宜君手撕兔.jpg",
  "16-宜君玉米糁-宜君玉米糁.jpg.jpg",
  "19-宜君核桃花椒锅巴-核桃花椒锅巴.png",
  "2-宜君党参-宜君党参.png",
  "6-宜君核桃仁-宜君核桃仁(红袋).png",
  "11-宜君核桃乳-宜君核桃乳.png",
  "12-宜君小酒缸-宜君小酒缸(45度白酒).png",
  "15-宜君苹果-宜君苹果礼盒手提袋.png",
  "18-蜂解柠檬蜜汁-宜君柠檬蜜汁.png",
  "3-宜君玉米糁-宜君玉米糁(白布袋).png",
  "21-宜君核桃仁-宜君核桃仁.png",
];
const SAMPLE_DESIGNS = SAMPLE_DESIGN_FILES.map(
  (f) => `${API_URL}/reference-images/${encodeURIComponent(f)}`,
);

// ─── Derived canvas state ──────────────────────────────────────────────────

interface PendingStyle {
  toolCallId: string;
  category?: string;
  options: StyleOption[];
}
interface SelectedStyle {
  label?: string;
  /** Thumbnails of every picked reference, in selection order (first = 主参考). */
  thumbnailUrls: string[];
  auto: boolean;
  /** How many references the user picked (multi-select). */
  count: number;
}
interface CanvasState {
  pendingStyle?: PendingStyle;
  pendingBriefId?: string;
  generating: boolean;
  results?: GenerationResult[];
  selectedStyle?: SelectedStyle;
  /** A confirmBrief was confirmed (user pressed 开始生成) at some point. */
  briefConfirmed: boolean;
  /** The most recent generateImage settled with an error / no images. */
  generateErrored: boolean;
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
  let briefConfirmed = false;
  let generateErrored = false;

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
          // Skip parts auto-denied because the user sent a message instead of
          // picking — there's no real selection to show.
          if (!out.denied) {
            const styleId = out.styleId;
            const match = options.find((o) => o.id === styleId);
            const picks: any[] = Array.isArray(out.styles) ? out.styles : [];
            // Resolve every pick's thumbnail from the original options.
            const thumbnailUrls =
              picks.length > 0
                ? picks
                    .map((s) => options.find((o) => o.id === s?.styleId)?.thumbnailUrl)
                    .filter((u): u is string => Boolean(u))
                : match?.thumbnailUrl
                  ? [match.thumbnailUrl]
                  : [];
            const count = picks.length > 0 ? picks.length : match ? 1 : 0;
            selectedStyle = {
              label: out.label || match?.label,
              thumbnailUrls,
              auto: styleId === "auto" || !match,
              count,
            };
          }
        }
      } else if (type === "tool-confirmBrief") {
        pendingBriefId = !isAnswered(part) ? part.toolCallId : undefined;
        if (isAnswered(part) && (part.output as any)?.confirmed) {
          briefConfirmed = true;
        }
      } else if (type === "tool-generateImage") {
        const settled =
          part.state === "output-available" || part.state === "output-error";
        if (!settled) {
          generating = true;
          results = undefined;
          generateErrored = false;
        } else {
          generating = false;
          const out = part.output;
          if (out?.success && Array.isArray(out.images) && out.images.length > 0) {
            results = out.images as GenerationResult[];
            generateErrored = false;
          } else if (out?.url) {
            results = [{ url: out.url, fileName: out.fileName ?? "image.png" }];
            generateErrored = false;
          } else {
            // settled but produced no usable image → treat as errored
            results = undefined;
            generateErrored = true;
          }
        }
      }
    }
  }

  return {
    pendingStyle,
    pendingBriefId,
    generating,
    results,
    selectedStyle,
    briefConfirmed,
    generateErrored,
  };
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
            "这些是过去做过的包装作品，给你找点灵感、参考一下。",
            "Past packaging designs — browse them for inspiration.",
          )}
        </p>
      </div>

      {/* Pinterest-style masonry waterfall */}
      <div className="columns-2 md:columns-3 gap-3 [column-fill:_balance]">
        {SAMPLE_DESIGNS.map((src) => (
          <div
            key={src}
            className="mb-3 break-inside-avoid rounded-xl border border-border bg-surface overflow-hidden shadow-card hover:shadow-lg transition-shadow"
          >
            <SmartImage src={src} alt="sample" minSkeletonHeight={160} />
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
  // Multi-select: tap to toggle, then confirm. The first pick is the 主参考
  // (drives field backfill in the agent); the rest are extra style references.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const toggle = (id: string) =>
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  const confirm = () => {
    const styles = selectedIds
      .map((id) => pending.options.find((o) => o.id === id))
      .filter((o): o is StyleOption => Boolean(o))
      .map((o) => ({ styleId: o.id, label: o.label, promptAnchor: o.promptAnchor }));
    if (styles.length === 0) return;
    // Keep styleId/label/promptAnchor at top level (= the 主参考, first pick) for
    // backward compat with deriveCanvasState; `styles` carries the full list.
    onPick({ ...styles[0], styles });
  };

  return (
    <CanvasShell>
      <CanvasTitle>
        {tt("挑你喜欢的风格（可多选）", "Pick the styles you like (multi-select)")}
        {pending.category ? ` · ${pending.category}` : ""}
      </CanvasTitle>
      <div className="columns-2 gap-3 [column-fill:_balance]">
        {pending.options.map((opt) => {
          const idx = selectedIds.indexOf(opt.id);
          const picked = idx >= 0;
          return (
            <button
              key={opt.id}
              disabled={disabled}
              onClick={() => toggle(opt.id)}
              className={`group relative block w-full mb-3 break-inside-avoid text-left rounded-xl border bg-surface overflow-hidden shadow-card transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                picked
                  ? "border-ocean-500 ring-2 ring-ocean-400"
                  : "border-border hover:border-ocean-400 hover:shadow-lg"
              }`}
            >
              {/* Selection order badge (1, 2, 3…) — #1 is the 主参考. */}
              {picked && (
                <span className="absolute top-2 right-2 z-10 inline-flex items-center justify-center w-6 h-6 rounded-full bg-ocean-500 text-white text-xs font-semibold shadow">
                  {idx + 1}
                </span>
              )}
              {/* Show the full reference image (no cropping) so the user sees the
                  complete packaging design before picking. */}
              <SmartImage src={opt.thumbnailUrl} alt={opt.label} minSkeletonHeight={160} />
            </button>
          );
        })}
      </div>
      <button
        disabled={disabled || selectedIds.length === 0}
        onClick={confirm}
        className="mt-4 w-full py-2.5 rounded-xl bg-ocean-500 text-white text-sm font-semibold hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {selectedIds.length > 0
          ? tt(`用这 ${selectedIds.length} 张 ✅`, `Use these ${selectedIds.length} ✅`)
          : tt("先点选一张或多张", "Select one or more first")}
      </button>
      <button
        disabled={disabled}
        onClick={() => onPick({ styleId: "auto", label: tt("你帮我选", "You decide"), promptAnchor: "", styles: [] })}
        className="mt-3 w-full py-2.5 rounded-xl border border-dashed border-border text-sm font-medium text-text-secondary hover:bg-surface-tertiary transition-colors cursor-pointer disabled:opacity-50"
      >
        {tt("都行，你帮我选 ✨", "Any is fine — you decide ✨")}
      </button>
    </CanvasShell>
  );
}

// ─── #2 Selected-style state (shown while collecting info) ───────────────────

function SelectedStyleView({ selected }: { selected: SelectedStyle }) {
  // Render up to 3 thumbnails as a stacked deck; the front card is the 主参考.
  const urls = selected.thumbnailUrls.slice(0, 3);
  const backCards = urls.slice(1); // sit behind the front card, fanned out

  return (
    <CanvasShell>
      <CanvasTitle>
        {tt("已选风格", "Selected style")}
        {selected.count > 1 ? ` · ${selected.count} ${tt("张", "refs")}` : ""}
      </CanvasTitle>
      {/* Right/bottom padding so the rotated back cards can peek without clipping. */}
      <div className="relative max-w-xs mx-auto pr-5 pb-5">
        {backCards.map((u, i) => (
          <div
            key={`bg-${i}`}
            aria-hidden
            className="absolute inset-0 rounded-2xl border border-ocean-200 bg-surface overflow-hidden shadow-card"
            style={{
              transform: `rotate(${(i + 1) * 4}deg) translate(${(i + 1) * 8}px, ${(i + 1) * 6}px)`,
              zIndex: i,
            }}
          >
            <SmartImage src={u} alt="" minSkeletonHeight={200} />
          </div>
        ))}
        <div
          className="relative rounded-2xl border-2 border-ocean-400 bg-surface overflow-hidden shadow-card"
          style={{ zIndex: backCards.length + 1 }}
        >
          {urls[0] ? (
            <SmartImage src={urls[0]} alt={selected.label} minSkeletonHeight={200} />
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
              {selected.auto
                ? tt("由 AI 为你挑选风格", "AI-picked style")
                : selected.count > 1
                  ? tt(`${selected.label} 等 ${selected.count} 张参考`, `${selected.label} +${selected.count - 1} more`)
                  : selected.label}
            </span>
          </div>
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
        {row(tt("净含量", "Net wt."), b.spec)}
        {row(tt("口味", "Flavor"), b.flavor)}
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
              <SmartImage
                key={u}
                src={u}
                alt="product"
                className="w-14 h-14 rounded-lg border border-border shrink-0"
                imgClassName="w-full h-full object-cover"
                minSkeletonHeight={0}
              />
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
  // The selection is shared with the chat input (shown as a tag there), so
  // read it from the store rather than local state — removing the tag in the
  // chat input clears the highlight here too.
  const selected = useSyncExternalStore(
    selectedImageStore.subscribe,
    selectedImageStore.getSnapshot,
    selectedImageStore.getSnapshot,
  );
  const selectedUrl = selected?.url ?? null;

  const select = (r: GenerationResult) => {
    if (disabled) return;
    // Toggle: tapping the selected image again clears it.
    if (selectedUrl === r.url) {
      selectedImageStore.clear();
      return;
    }
    onSelect(r);
  };

  return (
    <CanvasShell>
      <CanvasTitle>{tt("生成结果 · 选一张让 AI 接着改", "Results · pick one for the AI to edit")}</CanvasTitle>
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
                title={tt("选这张，让 AI 在它基础上继续编辑", "Pick this — the AI will edit from it")}
              >
                <SmartImage src={r.url} alt={r.fileName} minSkeletonHeight={220} />
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
          ? tt("已选中这张，去左侧告诉 AI 想怎么改", "Selected — tell the AI how to edit it on the left")
          : tt("选一张图，AI 就能在它的基础上继续编辑", "Pick one and the AI can keep editing it")}
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

  const {
    pendingStyle,
    pendingBriefId,
    generating,
    results,
    selectedStyle,
    briefConfirmed,
    generateErrored,
  } = deriveCanvasState(runtime.messages);
  const busy = runtime.status === "streaming" || runtime.status === "submitted";

  // Loading is shown only while we're *actively* working toward a generation.
  // - During generation: `generating` is true, but require `busy` too so that
  //   pressing Stop (which ends streaming but leaves the tool part unsettled)
  //   doesn't leave the canvas stuck on the loading screen (issue #3).
  // - Right after the brief is confirmed but before the generateImage call has
  //   streamed in, `generating` is still false; bridge that gap with
  //   `briefConfirmed` so the previous "已选风格" card doesn't flash (issue #1).
  const showLoading = generating
    ? busy
    : busy && briefConfirmed && !generateErrored && !results && !pendingStyle && !pendingBriefId;

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
  if (showLoading) return <Loading />;
  if (results && results.length > 0) {
    return (
      <Gallery
        results={results}
        // Selecting an image no longer sends a message — it just records the
        // pick as a reference (shown as a tag above the chat input) for the
        // next turn. So it stays enabled while the chat is busy.
        disabled={false}
        onSelect={(r) =>
          selectedImageStore.set({ url: r.url, fileName: r.fileName })
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
