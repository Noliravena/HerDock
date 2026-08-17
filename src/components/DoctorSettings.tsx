import { useEffect, useState } from "react";
import { ArrowClockwise, DownloadSimple } from "@phosphor-icons/react";
import { save } from "@tauri-apps/plugin-dialog";
import { hostApi, type DoctorReport, type DoctorStatus } from "../host/client";
import { useWorkbench } from "../store/workbench";
import { StatusPill, useConfirm } from "./pageElements";

function pillState(status: DoctorStatus): "done" | "waiting" | "failed" {
  if (status === "ok") return "done";
  if (status === "fail") return "failed";
  return "waiting";
}

function pillLabel(status: DoctorStatus) {
  if (status === "ok") return "正常";
  if (status === "fail") return "失败";
  return "注意";
}

export function DoctorSettings() {
  const cancelRun = useWorkbench((state) => state.cancelRun);
  const [askConfirm, confirmLayer] = useConfirm();
  const [report, setReport] = useState<DoctorReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const run = async () => {
    setBusy(true);
    setStatus("正在检查…");
    try {
      const next = await hostApi.doctor();
      setReport(next);
      const failed = next.checks.filter((check) => check.status === "fail").length;
      const warned = next.checks.filter((check) => check.status === "warn").length;
      setStatus(
        failed
          ? `${failed} 项失败。办公网可能需要 HTTP 代理。`
          : warned
            ? `${warned} 项需要注意`
            : "检查完成",
      );
    } catch (error) {
      setStatus(String(error));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void run();
  }, []);

  const exportZip = async () => {
    setBusy(true);
    setStatus("正在导出…");
    try {
      const dest = await save({
        defaultPath: `herdock-doctor-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.zip`,
        filters: [{ name: "Zip", extensions: ["zip"] }],
      });
      if (typeof dest !== "string") {
        setStatus("");
        return;
      }
      const path = await hostApi.exportDoctor(dest);
      setStatus(`已保存 ${path}`);
    } catch (error) {
      setStatus(String(error));
    } finally {
      setBusy(false);
    }
  };

  const cancelHung = async (runId: string) => {
    const ok = await askConfirm({
      title: "取消卡住的任务？",
      body: "将停止该运行。之后可以重新发送。",
      confirmLabel: "取消任务",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await cancelRun(runId);
      await run();
    } catch (error) {
      setStatus(String(error));
      setBusy(false);
    }
  };

  return (
    <div className="settings-stack" data-settings-id="doctor">
      {confirmLayer}
      <section className="settings-section">
        <div className="settings-section-head">
          <div>
            <b>环境诊断</b>
            <span>数据目录、Provider、MCP、代理与公网连通。401/403 视为可达。</span>
          </div>
        </div>
        <p className="settings-copy">
          此代理用于应用内 API 连通测试；CLI Provider 仍读取系统
          HTTP_PROXY。办公网访问失败时先填通用里的 HTTP 代理再测一次。
        </p>
        <div className="settings-actions">
          <span className="settings-status">{status}</span>
          <button type="button" disabled={busy} onClick={() => void run()}>
            <ArrowClockwise size={14} />
            重新检查
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => void exportZip()}
          >
            <DownloadSimple size={14} />
            导出诊断包
          </button>
        </div>
      </section>
      {report?.checks.map((check) => (
        <section className="settings-section doctor-check" key={check.id}>
          <div className="settings-section-head">
            <div>
              <b>{check.title}</b>
              <span>{check.detail}</span>
            </div>
            <div className="settings-actions">
              {check.runId ? (
                <button type="button" disabled={busy} onClick={() => void cancelHung(check.runId!)}>
                  取消任务
                </button>
              ) : null}
              <StatusPill state={pillState(check.status)} label={pillLabel(check.status)} />
            </div>
          </div>
        </section>
      ))}
      {report && report.probes.length > 0 && (
        <section className="settings-section">
          <div className="settings-section-head">
            <div>
              <b>网络探测</b>
              <span>超时或 DNS 失败通常表示需要 HTTP 代理</span>
            </div>
          </div>
          <div className="doctor-probes">
            {report.probes.map((probe) => (
              <div className="doctor-probe" key={probe.url}>
                <StatusPill state={pillState(probe.status)} label={pillLabel(probe.status)} />
                <code>{probe.url}</code>
                <span>
                  {probe.detail}
                  {probe.statusCode != null ? ` · HTTP ${probe.statusCode}` : ""}
                  {` · ${probe.elapsedMs}ms`}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
