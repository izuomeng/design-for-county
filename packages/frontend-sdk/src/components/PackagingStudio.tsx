import React from "react";
import { ChatWidget } from "./ChatWidget";
import { DesignCanvas } from "./DesignCanvas";

/**
 * 寻美 packaging-design studio — two-pane layout:
 *   - left:  the guided chat agent (ChatWidget)
 *   - right: the live design canvas (style picker / brief / results)
 *
 * On narrow screens the canvas stacks below the chat (responsive).
 * The canvas reads chat state via {@link studioStore}, which ChatWidget keeps
 * in sync, so no chat logic is duplicated here.
 */
export function PackagingStudio({ avatar }: { avatar?: string }) {
  return (
    <div className="flex flex-col md:flex-row h-full w-full bg-surface-secondary">
      {/* Left: chat */}
      <div className="h-1/2 md:h-full w-full md:w-[44%] md:max-w-[520px] md:shrink-0 md:border-r border-b md:border-b-0 border-border min-h-0 min-w-0">
        <ChatWidget avatar={avatar} />
      </div>
      {/* Right: design canvas */}
      <div className="h-1/2 md:h-full flex-1 min-h-0 min-w-0">
        <DesignCanvas />
      </div>
    </div>
  );
}
