/**
 * Selected-image store — a tiny external store holding the image the user
 * picked from the generation gallery, so it can be carried into the next chat
 * turn as a reference (context) instead of auto-sending a message.
 *
 * - The design canvas (`DesignCanvas` gallery) writes the pick via `set`.
 * - The chat input (`ChatWidget`) reads it to show a removable tag above the
 *   textarea, prepends a markdown blockquote reference to the outgoing message,
 *   then `clear`s it on send.
 *
 * Mirrors the singleton pattern used by `studioStore` / `uploadRegistry`.
 */

export interface SelectedImage {
  url: string;
  fileName?: string;
}

let selected: SelectedImage | null = null;
const listeners = new Set<() => void>();

export const selectedImageStore = {
  set(image: SelectedImage | null): void {
    selected = image;
    for (const listener of listeners) listener();
  },

  clear(): void {
    selectedImageStore.set(null);
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  /** Stable snapshot — only changes when set/clear is called. */
  getSnapshot(): SelectedImage | null {
    return selected;
  },
};
