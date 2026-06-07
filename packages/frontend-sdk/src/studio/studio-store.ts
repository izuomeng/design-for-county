/**
 * Studio store — a tiny external store that bridges the chat runtime
 * (`useChat`'s messages / addToolResult / sendMessage, owned by ChatWidget)
 * to the right-hand design canvas, without invasively lifting ChatWidget's
 * state. ChatWidget pushes the live runtime in via {@link studioStore.setRuntime};
 * the canvas reads it with `useSyncExternalStore`.
 *
 * This mirrors the singleton pattern already used by `uploadRegistry` and
 * `chatBridge`.
 */

export type AddToolResult = (args: {
  toolCallId: string;
  tool: string;
  output: unknown;
}) => void;

export type SendMessage = (message: { text: string }) => void;

export interface StudioRuntime {
  /** Live chat messages from `useChat`. */
  messages: any[];
  /** Chat status ("ready" | "submitted" | "streaming" | "error" | ...). */
  status: string;
  /** Return a tool result to the agent (for selectStyle / confirmBrief). */
  addToolResult: AddToolResult | null;
  /** Send a new user message (for canvas action buttons / modify requests). */
  sendMessage: SendMessage | null;
}

const initial: StudioRuntime = {
  messages: [],
  status: "ready",
  addToolResult: null,
  sendMessage: null,
};

let runtime: StudioRuntime = initial;
const listeners = new Set<() => void>();

export const studioStore = {
  /** Merge new runtime values and notify subscribers. */
  setRuntime(next: Partial<StudioRuntime>): void {
    runtime = { ...runtime, ...next };
    for (const listener of listeners) listener();
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  /** Stable snapshot — only changes when setRuntime is called. */
  getSnapshot(): StudioRuntime {
    return runtime;
  },
};
