export type BuiltinProviderId =
  "codex" | "claude" | "grok" | "openai" | "anthropic" | "xai" | "compatible";
export type ProviderId = BuiltinProviderId | (string & {});

export type AutoExecuteLevel = "ask_always" | "ask_risky" | "auto_workspace" | "auto_all";

export interface ProviderCapabilities {
  chat: boolean;
  streaming: boolean;
  tools: boolean;
  usage: boolean;
}
