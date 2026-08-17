import { ArrowDown } from "@phosphor-icons/react";
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";

const PIN_THRESHOLD = 24;

/**
 * Scroll viewport for the conversation. Content growth only sticks to the
 * bottom while the user is already there; scrolling up mid-stream keeps the
 * reading position and surfaces a floating pill with the unseen-message count.
 */
export function ThreadViewport({
  pinKey,
  messageCount,
  children,
}: {
  /** Changes whenever the content grows (event count). */
  pinKey: number;
  /** Coarse count of rendered chat messages, used for the unseen badge. */
  messageCount: number;
  children: ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const seenRef = useRef(messageCount);
  const [unseen, setUnseen] = useState(0);

  const distanceFromBottom = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight;

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const pinned = distanceFromBottom(el) < PIN_THRESHOLD;
    pinnedRef.current = pinned;
    if (pinned && seenRef.current !== messageCount) {
      seenRef.current = messageCount;
      setUnseen(0);
    }
  }, [messageCount]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (messageCount < seenRef.current) {
      // New run wiped the transcript — re-anchor without showing a badge.
      seenRef.current = messageCount;
      pinnedRef.current = true;
      setUnseen(0);
    }
    if (pinnedRef.current) {
      el.scrollTop = el.scrollHeight;
      return;
    }
    if (messageCount > seenRef.current) setUnseen(messageCount - seenRef.current);
    // pinKey intentionally drives re-runs; messageCount covered above.
  }, [pinKey, messageCount]);

  const jump = () => {
    const el = scrollRef.current;
    pinnedRef.current = true;
    seenRef.current = messageCount;
    setUnseen(0);
    el?.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  };

  return (
    <div className="thread-viewport">
      <div className="simple-thread" ref={scrollRef} onScroll={handleScroll}>
        {children}
      </div>
      {unseen > 0 && (
        <button type="button" className="thread-anchor" onClick={jump}>
          <ArrowDown size={12} />
          {unseen === 1 ? "1 条新消息" : `${unseen} 条新消息`}
        </button>
      )}
    </div>
  );
}
