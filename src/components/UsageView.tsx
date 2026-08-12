import { useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useWorkbench, type UsageRange } from "../store/workbench";
import { formatTokens } from "./RightPanel";

const RANGES: { id: UsageRange; label: string }[] = [
  { id: "7d", label: "7 天" },
  { id: "30d", label: "30 天" },
  { id: "mtd", label: "本月" },
];

/** Stable per-provider colours, reused by the legend, the stack and the table. */
const SERIES_COLORS = ["#3b5ba5", "#4a7a3c", "#a5622a", "#6b4f8a", "#b4483a", "#c4901f"];

function colorFor(providers: string[], id: string): string {
  const index = providers.indexOf(id);
  return SERIES_COLORS[(index < 0 ? 0 : index) % SERIES_COLORS.length];
}

function dayLabel(day: string): string {
  const d = new Date(`${day}T00:00:00`);
  if (Number.isNaN(d.getTime())) return day.slice(5);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function deltaLabel(current: number, previous: number): { text: string; up: boolean } | null {
  if (!previous) return null;
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return { text: "与上一周期持平", up: false };
  return { text: `${pct > 0 ? "↑" : "↓"} ${Math.abs(pct)}% 环比`, up: pct > 0 };
}

export function UsageView() {
  const state = useWorkbench(
    useShallow((s) => ({
      loadUsageSeries: s.loadUsageSeries,
      platform: s.platform,
      providers: s.providers,
      selectRun: s.selectRun,
      setUsageRange: s.setUsageRange,
      usage: s.usage,
      usageRange: s.usageRange,
      usageSeries: s.usageSeries,
    })),
  );

  useEffect(() => {
    void state.loadUsageSeries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const providerName = useMemo(
    () => new Map(state.providers.map((p) => [p.id, p.displayName])),
    [state.providers],
  );

  const model = useMemo(() => {
    const rows = state.usageSeries?.days || [];
    const providerIds = Array.from(new Set(rows.map((row) => row.providerId))).sort();
    const byDay = new Map<string, Map<string, number>>();
    const byProvider = new Map<string, { tokens: number; calls: number }>();
    let total = 0;
    let calls = 0;
    for (const row of rows) {
      const tokens = row.inputTokens + row.outputTokens;
      total += tokens;
      calls += row.calls;
      if (!byDay.has(row.day)) byDay.set(row.day, new Map());
      const day = byDay.get(row.day)!;
      day.set(row.providerId, (day.get(row.providerId) || 0) + tokens);
      const provider = byProvider.get(row.providerId) || { tokens: 0, calls: 0 };
      provider.tokens += tokens;
      provider.calls += row.calls;
      byProvider.set(row.providerId, provider);
    }
    const days = Array.from(byDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, parts]) => ({
        day,
        total: Array.from(parts.values()).reduce((sum, value) => sum + value, 0),
        parts: providerIds.map((id) => ({ id, tokens: parts.get(id) || 0 })),
      }));
    const peak = days.reduce((max, day) => Math.max(max, day.total), 0);
    const providerRows = Array.from(byProvider.entries())
      .map(([id, value]) => ({ id, ...value }))
      .sort((a, b) => b.tokens - a.tokens);
    return { providerIds, days, peak, providerRows, total, calls };
  }, [state.usageSeries]);

  const topRuns = state.usageSeries?.topRuns || [];
  const runCount = new Set(topRuns.map((r) => r.id)).size;
  const tokenDelta = deltaLabel(model.total, state.usageSeries?.previousTokens ?? 0);
  const contextUsed = state.usage?.context.used ?? 0;
  const contextLimit = state.usage?.context.limit ?? 200000;

  const cards = [
    { label: "区间 tokens", value: formatTokens(model.total), delta: tokenDelta },
    { label: "工具调用", value: String(model.calls), delta: null },
    {
      label: "最贵的 Run",
      value: topRuns[0] ? formatTokens(topRuns[0].tokens) : "—",
      delta: null,
    },
    {
      label: "当前上下文",
      value: `${formatTokens(contextUsed)} / ${formatTokens(contextLimit)}`,
      delta: null,
    },
  ];

  return (
    <div className="console-view usage-view">
      <header className="console-head">
        <h1>用量与成本</h1>
        <div className="seg">
          {RANGES.map((range) => (
            <button
              type="button"
              key={range.id}
              className={state.usageRange === range.id ? "active" : ""}
              onClick={() => void state.setUsageRange(range.id)}
            >
              {range.label}
            </button>
          ))}
        </div>
        <span className="console-meta">仅本机统计 · 不上传</span>
      </header>

      <div className="console-scroll">
        <div className="usage-grid">
          {cards.map((card) => (
            <div className="stat-card" key={card.label}>
              <span className="stat-label">{card.label}</span>
              <span className="stat-value">{card.value}</span>
              <span className={`stat-delta ${card.delta?.up ? "up" : "down"}`}>
                {card.delta?.text || " "}
              </span>
            </div>
          ))}
        </div>

        <section className="panel-block">
          <div className="panel-block-head">
            <strong>每日 token 消耗</strong>
            <span className="sub">按 Provider 堆叠</span>
            <div className="legend">
              {model.providerIds.map((id) => (
                <span key={id}>
                  <i style={{ background: colorFor(model.providerIds, id) }} />
                  {providerName.get(id) || id}
                </span>
              ))}
            </div>
          </div>
          {model.days.length ? (
            <div className="bar-chart">
              {model.days.map((day) => (
                <div className="bar-col" key={day.day}>
                  <span className="bar-total">{day.total ? formatTokens(day.total) : ""}</span>
                  <div className="bar-stack">
                    {day.parts.map((part) => (
                      <span
                        key={part.id}
                        title={`${providerName.get(part.id) || part.id} · ${formatTokens(part.tokens)}`}
                        style={{
                          height: `${model.peak ? Math.round((part.tokens / model.peak) * 108) : 0}px`,
                          background: colorFor(model.providerIds, part.id),
                        }}
                      />
                    ))}
                  </div>
                  <span className="bar-day">{dayLabel(day.day)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-hint">这个区间还没有本地用量记录。</div>
          )}
        </section>

        <div className="usage-columns">
          <section className="panel-block">
            <div className="panel-block-head">
              <strong>Provider 分布</strong>
            </div>
            <div className="provider-bars">
              {model.providerRows.map((row) => (
                <div className="provider-bar" key={row.id}>
                  <div className="provider-bar-top">
                    <i style={{ background: colorFor(model.providerIds, row.id) }} />
                    <span className="name">{providerName.get(row.id) || row.id}</span>
                    <span className="mono calls">{row.calls} 次调用</span>
                    <span className="mono tokens">{formatTokens(row.tokens)}</span>
                  </div>
                  <div className="meter">
                    <i
                      style={{
                        width: `${model.total ? Math.round((row.tokens / model.total) * 100) : 0}%`,
                        background: colorFor(model.providerIds, row.id),
                      }}
                    />
                  </div>
                </div>
              ))}
              {!model.providerRows.length && <div className="empty-hint">暂无数据。</div>}
            </div>
          </section>

          <section className="panel-block">
            <div className="panel-block-head">
              <strong>上下文窗口</strong>
              <span className="mono sub">
                {formatTokens(contextUsed)} / {formatTokens(contextLimit)}
              </span>
            </div>
            <div className="meter tall">
              <i
                style={{
                  width: `${Math.min(100, Math.round((contextUsed / Math.max(contextLimit, 1)) * 100))}%`,
                }}
              />
            </div>
            <p className="panel-note">
              超过窗口前 HerDock 会提示压缩或新建会话。所有统计都来自本机
              herdock-v1.db，不会上传，也不会向 Provider 查询账单。
            </p>
            <div className="bucket-list">
              {(state.usage?.buckets || []).map((bucket) => (
                <div className="bucket-row" key={bucket.key}>
                  <span className="k">{bucket.label}</span>
                  <span className="mono v">{formatTokens(bucket.tokens)}</span>
                  <span className="sub">
                    {bucket.runs} 次运行 · {bucket.calls} 个事件
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>

        <section className="panel-block flush">
          <div className="panel-block-head padded">
            <strong>最贵的 Run</strong>
            <span className="sub">{runCount} 条记录 · 按 token 排序</span>
          </div>
          {topRuns.map((run) => (
            <button
              type="button"
              className="usage-run-row"
              key={run.id}
              onClick={() => void state.selectRun(run.id)}
            >
              <span className="mono id">{run.id}</span>
              <span className="title">{run.title || "未命名运行"}</span>
              <span className="prov">{providerName.get(run.providerId) || run.providerId}</span>
              <span className="mono tokens">{formatTokens(run.tokens)}</span>
            </button>
          ))}
          {!topRuns.length && <div className="empty-hint">这个区间还没有带 usage 的运行。</div>}
        </section>
      </div>
    </div>
  );
}
