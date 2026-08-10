import {
  ArrowClockwise,
  ArrowLeft,
  ArrowRight,
  Globe,
  MagnifyingGlass,
  Scan,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { hostApi, type BrowserBounds, type BrowserStatus } from "../host/client";
import { useWorkbench } from "../store/workbench";

export function BrowserView({ browserId, initialUrl }: { browserId: string; initialUrl: string }) {
  const updateBrowserTab = useWorkbench((state) => state.updateBrowserTab);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const initialUrlRef = useRef(initialUrl);
  const editing = useRef(false);
  const statusRefreshTimer = useRef<number | null>(null);
  const [address, setAddress] = useState(initialUrl);
  const [status, setStatus] = useState<BrowserStatus>({
    id: browserId,
    url: initialUrl,
    title: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [snapshotCount, setSnapshotCount] = useState<number | null>(null);

  const syncStatus = useCallback(
    (next: BrowserStatus) => {
      setStatus(next);
      if (!editing.current) setAddress(next.url);
      updateBrowserTab(browserId, { label: next.title || "浏览器", url: next.url });
    },
    [browserId, updateBrowserTab],
  );

  const refreshStatusAfter = useCallback(
    (delay: number) => {
      if (statusRefreshTimer.current != null) {
        clearTimeout(statusRefreshTimer.current);
      }
      statusRefreshTimer.current = window.setTimeout(() => {
        statusRefreshTimer.current = null;
        void hostApi
          .browserStatus(browserId)
          .then(syncStatus)
          .catch((reason) => setError(String(reason)))
          .finally(() => setLoading(false));
      }, delay);
    },
    [browserId, syncStatus],
  );

  useEffect(() => {
    let cancelled = false;
    let observer: ResizeObserver | undefined;
    let frame = 0;
    let poll = 0;
    let polling = false;
    const resize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const bounds = browserBounds(surfaceRef.current);
        if (bounds) void hostApi.setBrowserBounds(browserId, bounds).catch(() => undefined);
      });
    };
    void (async () => {
      await nextFrame();
      const bounds = browserBounds(surfaceRef.current);
      if (!bounds) return;
      try {
        const next = await hostApi.createBrowser(browserId, initialUrlRef.current, bounds);
        if (cancelled) {
          void hostApi.hideBrowser(browserId);
          return;
        }
        syncStatus(next);
        setLoading(false);
        observer = new ResizeObserver(resize);
        observer.observe(surfaceRef.current as Element);
        poll = window.setInterval(() => {
          if (polling) return;
          polling = true;
          void hostApi
            .browserStatus(browserId)
            .then(syncStatus)
            .catch(() => undefined)
            .finally(() => {
              polling = false;
            });
        }, 1_500);
      } catch (reason) {
        if (!cancelled) {
          setError(String(reason));
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      observer?.disconnect();
      cancelAnimationFrame(frame);
      clearInterval(poll);
      if (statusRefreshTimer.current != null) clearTimeout(statusRefreshTimer.current);
      void hostApi.hideBrowser(browserId).catch(() => undefined);
    };
  }, [browserId, syncStatus]);

  const navigate = async (target: string) => {
    if (!target.trim()) return;
    setLoading(true);
    setError(null);
    try {
      syncStatus(await hostApi.navigateBrowser(browserId, target));
      refreshStatusAfter(650);
    } catch (reason) {
      setError(String(reason));
      setLoading(false);
    }
  };

  const historyAction = async (action: "back" | "forward" | "reload") => {
    setLoading(true);
    const command =
      action === "back"
        ? hostApi.browserBack
        : action === "forward"
          ? hostApi.browserForward
          : hostApi.reloadBrowser;
    try {
      await command(browserId);
      refreshStatusAfter(450);
    } catch (reason) {
      setError(String(reason));
      setLoading(false);
    }
  };

  const inspect = async () => {
    try {
      const snapshot = await hostApi.browserSnapshot(browserId, 20_000);
      setSnapshotCount(snapshot.interactive?.length ?? 0);
      setError(snapshot.ok ? null : snapshot.error || "页面读取失败");
    } catch (reason) {
      setError(String(reason));
    }
  };

  return (
    <div className="browser-view">
      <div className="browser-toolbar">
        <div className="browser-nav">
          <button type="button" title="后退" onClick={() => void historyAction("back")}>
            <ArrowLeft size={15} />
          </button>
          <button type="button" title="前进" onClick={() => void historyAction("forward")}>
            <ArrowRight size={15} />
          </button>
          <button type="button" title="刷新" onClick={() => void historyAction("reload")}>
            <ArrowClockwise size={15} className={loading ? "spin" : ""} />
          </button>
        </div>
        <form
          className="browser-address"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            editing.current = false;
            void navigate(address);
          }}
        >
          {address.startsWith("http") ? <Globe size={13} /> : <MagnifyingGlass size={13} />}
          <input
            value={address}
            aria-label="网址或搜索内容"
            onFocus={() => {
              editing.current = true;
            }}
            onBlur={() => {
              editing.current = false;
            }}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="输入网址或搜索内容"
          />
        </form>
        <button
          type="button"
          className="browser-inspect"
          title="读取页面结构"
          onClick={() => void inspect()}
        >
          <Scan size={15} />
          {snapshotCount != null && <span>{snapshotCount}</span>}
        </button>
      </div>
      {(error || status.title) && (
        <div className={`browser-status-line ${error ? "error" : ""}`}>
          <span>{error || status.title}</span>
          <code>{status.url}</code>
        </div>
      )}
      <div ref={surfaceRef} className="browser-surface">
        {loading && (
          <div className="browser-loading">
            <ArrowClockwise size={18} className="spin" />
          </div>
        )}
        {error && <div className="browser-error">{error}</div>}
      </div>
    </div>
  );
}

export function browserBounds(element: HTMLElement | null): BrowserBounds | null {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return null;
  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
