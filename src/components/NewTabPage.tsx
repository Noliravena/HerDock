import { Browser, ChatCircleDots, Code, ListBullets, TerminalWindow } from "@phosphor-icons/react";
import { useWorkbench, type TabFeature } from "../store/workbench";

const FEATURES: {
  id: TabFeature;
  label: string;
  meta: string;
  icon: typeof Browser;
  workspace?: boolean;
}[] = [
  { id: "browser", label: "浏览器", meta: "WEB", icon: Browser },
  { id: "agent", label: "Agent 会话", meta: "AGENT", icon: ChatCircleDots, workspace: true },
  { id: "terminal", label: "终端", meta: "PTY", icon: TerminalWindow, workspace: true },
  { id: "editor", label: "编辑器", meta: "CODE", icon: Code, workspace: true },
  { id: "activity", label: "活动", meta: "RUNS", icon: ListBullets },
];

export function NewTabPage({ tabKey }: { tabKey: string }) {
  const configureTab = useWorkbench((state) => state.configureTab);
  const workspace = useWorkbench((state) => state.workspace);
  return (
    <div className="new-tab-page">
      <div className="new-tab-inner">
        <header>
          <h2>新建标签</h2>
          <span>SELECT VIEW</span>
        </header>
        <div className="new-tab-grid">
          {FEATURES.map((feature) => {
            const FeatureIcon = feature.icon;
            const disabled = feature.workspace && !workspace;
            return (
              <button
                key={feature.id}
                type="button"
                className="new-tab-option"
                disabled={disabled}
                onClick={() => void configureTab(tabKey, feature.id)}
              >
                <span className="new-tab-icon">
                  <FeatureIcon size={21} weight="regular" />
                </span>
                <span className="new-tab-option-label">{feature.label}</span>
                <span className="new-tab-option-meta">
                  {disabled ? "需要工作区" : feature.meta}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
