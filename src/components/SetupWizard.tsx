import { useEffect, useState } from "react";
import {
  ArrowRight,
  Check,
  FirstAid,
  FolderOpen,
  PlugsConnected,
  WifiHigh,
} from "@phosphor-icons/react";
import { open } from "@tauri-apps/plugin-dialog";
import { useShallow } from "zustand/react/shallow";
import { hostApi, type ProbeResult } from "../host/client";
import { useWorkbench } from "../store/workbench";
import { StatusPill } from "./pageElements";

const STEPS = ["welcome", "workspace", "network", "providers", "done"] as const;
type Step = (typeof STEPS)[number];

export function SetupWizard() {
  const {
    closeSetupWizard,
    openSettings,
    openWorkspacePath,
    persistSettings,
    providers,
    settings,
    workspace,
    workspaces,
  } = useWorkbench(
    useShallow((state) => ({
      closeSetupWizard: state.closeSetupWizard,
      openSettings: state.openSettings,
      openWorkspacePath: state.openWorkspacePath,
      persistSettings: state.persistSettings,
      providers: state.providers,
      settings: state.settings,
      workspace: state.workspace,
      workspaces: state.workspaces,
    })),
  );
  const [step, setStep] = useState<Step>("welcome");
  const [proxy, setProxy] = useState(settings.httpProxy);
  const [probes, setProbes] = useState<ProbeResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => setProxy(settings.httpProxy), [settings.httpProxy]);

  const finish = async (skipped: boolean) => {
    setBusy(true);
    try {
      await persistSettings({
        ...settings,
        httpProxy: proxy,
        setupComplete: true,
      });
      closeSetupWizard();
      if (!skipped) setStatus("");
    } catch (error) {
      setStatus(String(error));
    } finally {
      setBusy(false);
    }
  };

  const probe = async () => {
    setBusy(true);
    setStatus("正在探测网络…");
    try {
      await persistSettings({ ...settings, httpProxy: proxy });
      const results = await hostApi.probeNetwork();
      setProbes(results);
      const failed = results.filter((item) => item.status === "fail").length;
      setStatus(
        failed === results.length && results.length
          ? "探测全部失败。办公网可能需要 HTTP 代理。"
          : "探测完成。401/403 表示网络路径正常。",
      );
    } catch (error) {
      setStatus(String(error));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (step === "network" && probes == null && !busy) void probe();
    // Intentionally run once when entering the network step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const openFolder = async () => {
    const path = await open({ directory: true, multiple: false, title: "打开本地工作区" });
    if (typeof path === "string") await openWorkspacePath(path);
  };

  const available = providers.filter((item) => item.available).length;
  const probeFailed = Boolean(probes?.length && probes.every((item) => item.status === "fail"));
  const index = STEPS.indexOf(step);
  const goNext = () => setStep(STEPS[Math.min(index + 1, STEPS.length - 1)]);
  const goBack = () => setStep(STEPS[Math.max(index - 1, 0)]);

  return (
    <div className="setup-wizard-scrim" role="presentation">
      <section className="setup-wizard" role="dialog" aria-modal="true" aria-label="初次设置">
        <header className="setup-wizard-head">
          <div>
            <div className="settings-title">开始使用 HerDock</div>
            <div className="settings-subtitle">
              先确认工作区、网络和至少一个 Provider。不是 Grok CLI 硬门槛。
            </div>
          </div>
          <button type="button" className="ghost" disabled={busy} onClick={() => void finish(true)}>
            跳过
          </button>
        </header>

        <div className="setup-wizard-body">
          {step === "welcome" && (
            <div className="setup-wizard-copy">
              <p>HerDock 是多 Provider 工作台。办公网环境请准备 HTTP 代理，再测连通。</p>
              <p>跳过后不会每次启动都打扰；可随时用命令面板或 /setup 再走一遍。</p>
            </div>
          )}

          {step === "workspace" && (
            <div className="setup-wizard-copy">
              <p>
                {workspaces.length
                  ? `已记录 ${workspaces.length} 个工作区${workspace ? `，当前是 ${workspace.name}` : ""}。`
                  : "还没有打开工作区。这一步可以稍后再做。"}
              </p>
              <button type="button" onClick={() => void openFolder()}>
                <FolderOpen size={14} />
                打开文件夹
              </button>
            </div>
          )}

          {step === "network" && (
            <div className="setup-wizard-copy">
              <label className="full">
                HTTP 代理
                <input
                  value={proxy}
                  onChange={(event) => setProxy(event.target.value)}
                  placeholder="http://127.0.0.1:7890"
                />
              </label>
              <p>此代理用于应用内 API 连通测试。CLI Provider 仍读取系统 HTTP_PROXY。</p>
              <div className="settings-actions">
                <span className="settings-status">{status}</span>
                <button type="button" disabled={busy} onClick={() => void probe()}>
                  <WifiHigh size={14} />
                  测试连通
                </button>
              </div>
              {probes?.map((probeItem) => (
                <div className="doctor-probe" key={probeItem.url}>
                  <StatusPill
                    state={
                      probeItem.status === "ok"
                        ? "done"
                        : probeItem.status === "fail"
                          ? "failed"
                          : "waiting"
                    }
                    label={
                      probeItem.status === "ok"
                        ? "可达"
                        : probeItem.status === "fail"
                          ? "失败"
                          : "注意"
                    }
                  />
                  <code>{probeItem.url}</code>
                  <span>{probeItem.detail}</span>
                </div>
              ))}
              {probeFailed && (
                <p className="setup-wizard-warn">
                  完成前网络仍不通。可以先填代理，或稍后在设置 → 诊断里再测。
                </p>
              )}
            </div>
          )}

          {step === "providers" && (
            <div className="setup-wizard-copy">
              <p>
                {available
                  ? `${available} 个 Provider 已连接。未连接的不会标成已连接。`
                  : "还没有可用的 Provider。可以先去设置里填写 CLI 路径或 API Key。"}
              </p>
              <div className="setup-wizard-providers">
                {providers.map((provider) => (
                  <div className="doctor-probe" key={provider.id}>
                    <StatusPill
                      state={provider.available ? "done" : "waiting"}
                      label={provider.available ? "已连接" : "未连接"}
                    />
                    <strong>{provider.displayName}</strong>
                    <span>{provider.detail || provider.auth}</span>
                  </div>
                ))}
              </div>
              <button type="button" onClick={() => openSettings({ tab: "providers" })}>
                <PlugsConnected size={14} />
                打开 Provider 设置
              </button>
            </div>
          )}

          {step === "done" && (
            <div className="setup-wizard-copy">
              <p>可以开始工作了。诊断包和代理仍在设置里。</p>
              {probeFailed && (
                <p className="setup-wizard-warn">网络探测未通过。办公网可能仍需 HTTP 代理。</p>
              )}
              <button type="button" onClick={() => openSettings({ tab: "doctor" })}>
                <FirstAid size={14} />
                打开诊断
              </button>
            </div>
          )}
        </div>

        <footer className="setup-wizard-foot">
          <button type="button" disabled={busy || step === "welcome"} onClick={goBack}>
            上一步
          </button>
          {step === "done" ? (
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => void finish(false)}
            >
              <Check size={14} />
              完成
            </button>
          ) : (
            <button type="button" className="primary" disabled={busy} onClick={goNext}>
              下一步
              <ArrowRight size={14} />
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}
