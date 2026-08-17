import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { hostApi } from "../host/client";
import { useWorkbench, type UsageRange } from "../store/workbench";
import { ConsoleShell, CostMeter, PageEmpty } from "./pageElements";

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

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

type StatTone = "up" | "down" | "flat";

function deltaLabel(current: number, previous: number): { text: string; tone: StatTone } | null {
  if (!previous) return null;
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return { text: "与上一周期持平", tone: "flat" };
  return { text: `${pct > 0 ? "↑" : "↓"} ${Math.abs(pct)}% 环比`, tone: pct > 0 ? "up" : "down" };
}

/** RFC 4180 quoting so Chinese run titles with commas survive the round trip. */
function csvCell(value: string | number): string {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function fileStamp(): string {
  const d = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

export function UsageView() {
  const state = useWorkbench(
    useShallow((s) => ({
      loadUsageSeries: s.loadUsageSeries,
      hostOnline: s.hostOnline,
      providers: s.providers,
      selectRun: s.selectRun,
      setUsageRange: s.setUsageRange,
      usage: s.usage,
      usageRange: s.usageRange,
      usageSeries: s.usageSeries,
      workspace: s.workspace,
    })),
  );
  const [exportedPath, setExportedPath] = useState("");

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
    let input = 0;
    let output = 0;
    for (const row of rows) {
      const tokens = row.inputTokens + row.outputTokens;
      total += tokens;
      input += row.inputTokens;
      output += row.outputTokens;
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
    return { providerIds, days, peak, providerRows, total, calls, input, output };
  }, [state.usageSeries]);

  const topRuns = state.usageSeries?.topRuns || [];
  const runCount = new Set(topRuns.map((r) => r.id)).size;
  const tokenDelta = deltaLabel(model.total, state.usageSeries?.previousTokens ?? 0);
  const contextUsed = state.usage?.context.used ?? 0;
  const contextLimit = state.usage?.context.limit ?? 200000;

  const contextPct = Math.min(100, Math.round((contextUsed / Math.max(contextLimit, 1)) * 100));
  const flat = (text: string) => ({ text, tone: "flat" as StatTone });
  const cards = [
    { label: "区间 tokens", value: formatTokens(model.total), delta: tokenDelta },
    {
      label: "工具调用",
      value: String(model.calls),
      delta: flat(model.days.length ? `${model.days.length} 天有记录` : "暂无记录"),
    },
    {
      label: "最贵的 Run",
      value: topRuns[0] ? formatTokens(topRuns[0].tokens) : "—",
      delta: topRuns[0]
        ? flat(providerName.get(topRuns[0].providerId) || topRuns[0].providerId)
        : null,
    },
    {
      label: "当前上下文",
      value: `${formatTokens(contextUsed)} / ${formatTokens(contextLimit)}`,
      delta: flat(`已用 ${contextPct}%`),
    },
  ];

  const exportCsv = async () => {
    if (!state.workspace || !topRuns.length) return;
    const lines = [
      "run_id,title,provider,tokens",
      ...topRuns.map((run) =>
        [
          csvCell(run.id),
          csvCell(run.title || "未命名运行"),
          csvCell(providerName.get(run.providerId) || run.providerId),
          run.tokens,
        ].join(","),
      ),
    ];
    const path = `out/usage/top-runs-${state.usageRange}-${fileStamp()}.csv`;
    // BOM keeps Excel on Windows from mangling the Chinese run titles.
    await hostApi.writeFile(state.workspace.id, path, `\ufeff${lines.join("\n")}\n`);
    setExportedPath(path);
    await hostApi.revealArtifact(state.workspace.id, path);
  };

  return (
    <ConsoleShell
      title="用量"
      hostOnline={state.hostOnline}
      className="usage-view"
      actions={
        <div className="g-tabs">
          {RANGES.map((range) => (
            <button
              type="button"
              key={range.id}
              className={state.usageRange === range.id ? "on" : ""}
              onClick={() => void state.setUsageRange(range.id)}
            >
              {range.label}
            </button>
          ))}
        </div>
      }
    >
      <div className="usage-grid">
        {cards.map((card) => (
          <div className="stat-card" key={card.label}>
            <span className="stat-label">{card.label}</span>
            <span className="stat-value" key={card.value}>
              {card.value}
            </span>
            <span className={`stat-delta ${card.delta?.tone || "flat"}`}>
              {card.delta?.text || " "}
            </span>
          </div>
        ))}
      </div>

      {model.input + model.output > 0 && (
        <section className="panel-block">
          <div className="panel-block-head">
            <strong>Token 份额</strong>
            <span className="sub">按 in / out，无单价换算</span>
          </div>
          <CostMeter input={model.input} output={model.output} />
        </section>
      )}

      <section className="panel-block">
        <div className="panel-block-head">
          <strong>每日 token 消耗</strong>
          <span className="sub">按 Provider 堆叠</span>
          {!!model.providerIds.length && (
            <div className="legend">
              {model.providerIds.map((id) => (
                <span key={id}>
                  <i style={{ background: colorFor(model.providerIds, id) }} />
                  {providerName.get(id) || id}
                </span>
              ))}
            </div>
          )}
        </div>
        {model.days.some((day) => day.total > 0) ? (
          <div className="bar-chart">
            {model.days.map((day) => (
              <div className="bar-col" key={day.day}>
                <span className="bar-total">{day.total ? formatTokens(day.total) : ""}</span>
                <div className="bar-stack">
                  {day.parts
                    .filter((part) => part.tokens > 0)
                    .map((part) => (
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
          <div className="aui-chart-empty">
            <PageEmpty
              title="这个区间还没有用量"
              body="本地 herdock-v1.db 里没有可画的 token 记录。"
            />
          </div>
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
            {!model.providerRows.length && (
              <div className="aui-chart-empty">
                <PageEmpty title="暂无分布" body="这个区间还没有按 Provider 汇总的 token。" />
              </div>
            )}
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

      <section className="panel-block">
        <SchedulesPanel />
      </section>

      <section className="panel-block flush">
        <div className="panel-block-head padded">
          <strong>最贵的 Run</strong>
          <span className="sub">{runCount} 条记录 · 按 token 排序</span>
          <button
            type="button"
            className="link-btn"
            disabled={!topRuns.length || !state.workspace}
            onClick={() => void exportCsv()}
          >
            导出 CSV
          </button>
        </div>
        {exportedPath && <div className="panel-note mono padded">已写入 {exportedPath}</div>}
        {topRuns.length ? (
          <div className="aui-table-wrap">
            <table className="aui-table" data-slot="data-table">
              <thead>
                <tr>
                  <th>Run</th>
                  <th>标题</th>
                  <th>Provider</th>
                  <th className="num">tokens</th>
                </tr>
              </thead>
              <tbody>
                {topRuns.map((run) => (
                  <tr key={run.id} onClick={() => void state.selectRun(run.id)}>
                    <td className="mono">{run.id}</td>
                    <td>{run.title || "未命名运行"}</td>
                    <td>{providerName.get(run.providerId) || run.providerId}</td>
                    <td className="num">{formatTokens(run.tokens)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="aui-chart-empty">
            <PageEmpty title="还没有带用量的运行" body="这个区间没有可排序的 token 记录。" />
          </div>
        )}
      </section>
    </ConsoleShell>
  );
}

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

/** Render a 5-field cron as the Chinese label used in the design (每天 07:00 …). */
function cronLabel(cron: string): string {
  const f = cron.trim().split(/\s+/);
  if (f.length !== 5) return cron;
  const [min, hour, dom, mon, dow] = f;
  if (!/^\d+$/.test(min) || !/^\d+$/.test(hour)) return cron;
  const at = `${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;
  if (dom === "*" && mon === "*" && dow === "*") return `每天 ${at}`;
  if (dom === "*" && mon === "*" && /^\d$/.test(dow)) return `每周${WEEKDAYS[Number(dow)]} ${at}`;
  if (dom === "*" && mon === "*" && dow === "1-5") return `工作日 ${at}`;
  if (dom === "*" && mon === "*" && dow === "0,6") return `周末 ${at}`;
  if (dom === "*" && mon === "*" && /^[0-6](,[0-6])+$/.test(dow)) {
    const days = dow
      .split(",")
      .map((d) => WEEKDAYS[Number(d)])
      .join("、");
    return `每周${days} ${at}`;
  }
  if (/^\d+$/.test(dom) && mon === "*" && dow === "*") return `每月 ${dom} 日 ${at}`;
  return cron;
}

function formatNext(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 定时任务管理，从旧工作台右侧面板移植。 */
function SchedulesPanel() {
  const state = useWorkbench(
    useShallow((s) => ({
      providerId: s.providerId,
      schedules: s.schedules,
      toggleSchedule: s.toggleSchedule,
      workspace: s.workspace,
    })),
  );
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [cron, setCron] = useState("0 9 * * 1-5");
  const save = async () => {
    if (!state.workspace || !name.trim() || !prompt.trim()) return;
    try {
      const schedule = await hostApi.saveSchedule({
        workspaceId: state.workspace.id,
        name,
        prompt,
        cron,
        providerId: state.providerId,
        enabled: true,
      });
      useWorkbench.setState({ schedules: [...state.schedules, schedule] });
      setOpen(false);
      setName("");
      setPrompt("");
    } catch (error) {
      useWorkbench.setState({ error: String(error) });
    }
  };
  const remove = async (id: string) => {
    await hostApi.deleteSchedule(id);
    useWorkbench.setState((s) => ({ schedules: s.schedules.filter((item) => item.id !== id) }));
  };

  return (
    <>
      <div className="panel-block-head">
        <strong>定时任务</strong>
        <button type="button" className="link-btn" onClick={() => setOpen((v) => !v)}>
          {open ? "收起" : "新建"}
        </button>
      </div>
      {open && (
        <div className="schedule-form">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="任务名称"
          />
          <input
            value={cron}
            onChange={(event) => setCron(event.target.value)}
            placeholder="5 段 Cron"
          />
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="定时运行的提示词"
            rows={3}
          />
          <button
            type="button"
            disabled={!state.workspace || !name.trim() || !prompt.trim()}
            onClick={() => void save()}
          >
            保存本地计划
          </button>
        </div>
      )}
      <div className="bucket-list">
        {state.schedules.map((sc) => (
          <div className="bucket-row" key={sc.id}>
            <span className="k">
              {sc.name}
              <small className="cron" title={sc.cron}>
                {cronLabel(sc.cron)}
              </small>
            </span>
            <span className="sub">
              {sc.enabled ? `下次 ${formatNext(sc.nextRunAt)}` : "已暂停"}
            </span>
            <button
              type="button"
              className="link-btn"
              onClick={() => void state.toggleSchedule(sc.id)}
            >
              {sc.enabled ? "暂停" : "启用"}
            </button>
            <button type="button" className="link-btn" onClick={() => void remove(sc.id)}>
              删除
            </button>
          </div>
        ))}
        {!state.schedules.length && (
          <div className="empty-hint">还没有定时任务，可在这里创建本地计划。</div>
        )}
      </div>
    </>
  );
}
