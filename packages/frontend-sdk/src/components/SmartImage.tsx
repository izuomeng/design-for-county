import React, { useEffect, useState } from "react";

/**
 * Whether a string is a *complete* image URL worth loading.
 *
 * During streaming, an image URL in assistant text (or a tool result) arrives
 * character by character. Binding a partial value to `<img src>` makes the
 * browser fire a request for every prefix → a flood of 404s and a broken-image
 * flash before the final URL resolves. We only load once the URL looks final:
 * a data-URI, or an http(s)/root path ending in a known image extension.
 */
export function isCompleteImageUrl(src?: string): boolean {
  if (!src) return false;
  if (src.startsWith("data:image/")) return true;
  return /^(https?:\/\/|\/)\S+\.(png|jpe?g|webp|gif|avif|svg)(\?\S*)?$/i.test(src);
}

interface SmartImageProps {
  src?: string;
  alt?: string;
  /** Classes for the wrapper — put sizing / rounding / border here. */
  className?: string;
  /** Classes for the inner <img> — put object-fit etc. here. */
  imgClassName?: string;
  loading?: "lazy" | "eager";
  /**
   * Min height (px) the skeleton reserves while loading. Use 0 when the wrapper
   * already has a fixed height (e.g. a w-14 h-14 thumbnail).
   */
  minSkeletonHeight?: number;
  onClick?: () => void;
}

/**
 * Image with a loading skeleton, fade-in, and graceful failure.
 *
 * - Shows a pulsing skeleton until the image actually loads.
 * - Only sets `src` once the URL is complete (see {@link isCompleteImageUrl}),
 *   so streaming/partial URLs never hit the network or flash a broken icon.
 * - On load error, collapses quietly instead of showing the broken-image glyph.
 */
export function SmartImage({
  src,
  alt = "",
  className = "",
  imgClassName = "block w-full h-auto",
  loading = "lazy",
  minSkeletonHeight = 96,
  onClick,
}: SmartImageProps) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const ready = isCompleteImageUrl(src);

  // Reset load state whenever the source changes.
  useEffect(() => {
    setLoaded(false);
    setFailed(false);
  }, [src]);

  const showSkeleton = ready ? !loaded : !failed;

  return (
    <span className={`relative block overflow-hidden ${className}`} onClick={onClick}>
      {showSkeleton && (
        <span className="absolute inset-0 animate-pulse bg-surface-tertiary" aria-hidden="true" />
      )}
      {ready && !failed && (
        <img
          src={src}
          alt={alt}
          loading={loading}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={`relative ${imgClassName} ${loaded ? "opacity-100" : "opacity-0"} transition-opacity duration-300`}
        />
      )}
      {/* Reserve height for the skeleton until the image supplies its own. */}
      {showSkeleton && !loaded && minSkeletonHeight > 0 && (
        <span className="block" style={{ minHeight: minSkeletonHeight }} aria-hidden="true" />
      )}
    </span>
  );
}
