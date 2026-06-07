import { MESSAGE_ROLE, TOOL_PART_STATE, TOOL_PART_TYPE_PREFIX } from "oceanmcp-shared";

const AUTO_DENY_REASON =
  "User sent a new message instead of responding to approval.";

const AUTO_DENY_SELECT_REASON =
  "User sent a new message instead of responding to input request.";

function isToolPart(part: any): boolean {
  return (
    typeof part?.type === "string" &&
    part.type.startsWith(TOOL_PART_TYPE_PREFIX)
  );
}

// Client-side interactive tools (no server execute) that wait on the user via
// an "input-available" part. If the user sends a new message instead of
// responding, the assistant's tool_call has no matching tool result and the
// model API rejects the next request — so these must be converted to
// output-denied. Covers askUser plus the packaging-design canvas tools.
const INPUT_REQUEST_TOOLS = new Set([
  "askUser",
  "userSelect", // legacy
  "selectStyle",
  "confirmBrief",
]);

function isInputRequestPart(part: any): boolean {
  if (!isToolPart(part) || typeof part.type !== "string") return false;
  return INPUT_REQUEST_TOOLS.has(part.type.slice(TOOL_PART_TYPE_PREFIX.length));
}

function shouldAutoDeny(part: any): boolean {
  return (
    isToolPart(part) &&
    part.state === TOOL_PART_STATE.APPROVAL_RESPONDED &&
    part.approval?.approved === false
  );
}

/**
 * OpenAI-compatible chat completions require a tool result message for each
 * prior tool call before the next user turn. Approval-only parts do not satisfy
 * that requirement, so we convert stale approval waits (when user already moved
 * on) and explicit denied approvals into `output-denied` to emit a proper
 * tool result.
 *
 * Similarly, pending askUser parts (state "input-available") that have a
 * later user message are also converted to `output-denied` so the LLM
 * receives a proper tool result instead of hanging.
 */
export function normalizeStaleInteractions(messages: any[]): any[] {
  return messages.map((message, index) => {
    if (
      message.role !== MESSAGE_ROLE.ASSISTANT ||
      !Array.isArray(message.parts)
    ) {
      return message;
    }

    const hasLaterUserMessage = messages
      .slice(index + 1)
      .some((m) => m?.role === MESSAGE_ROLE.USER);

    let changed = false;
    const parts = message.parts.map((part: any) => {
      // Stale approval: user moved on past a pending approval request
      const denyBecauseMovedOn =
        isToolPart(part) &&
        part.state === TOOL_PART_STATE.APPROVAL_REQUESTED &&
        hasLaterUserMessage;

      if (denyBecauseMovedOn || shouldAutoDeny(part)) {
        changed = true;
        return {
          ...part,
          state: TOOL_PART_STATE.OUTPUT_DENIED,
          approval: {
            id: part.approval?.id ?? `auto-deny-${part.toolCallId ?? index}`,
            approved: false,
            reason: part.approval?.reason ?? AUTO_DENY_REASON,
          },
        };
      }

      // Stale input request (askUser / selectStyle / confirmBrief): user moved
      // on past a pending interaction without responding to it.
      const denySelectBecauseMovedOn =
        isInputRequestPart(part) &&
        part.state === TOOL_PART_STATE.INPUT_AVAILABLE &&
        hasLaterUserMessage;

      if (denySelectBecauseMovedOn) {
        changed = true;
        return {
          ...part,
          state: TOOL_PART_STATE.OUTPUT_DENIED,
          output: { denied: true, reason: AUTO_DENY_SELECT_REASON },
          // AI SDK v6 unconditionally reads `approval.reason` when
          // converting OUTPUT_DENIED parts to model messages, so we
          // must provide an approval object even for askUser parts.
          approval: {
            id: `auto-deny-select-${part.toolCallId ?? index}`,
            approved: false,
            reason: AUTO_DENY_SELECT_REASON,
          },
        };
      }

      return part;
    });

    return changed ? { ...message, parts } : message;
  });
}
