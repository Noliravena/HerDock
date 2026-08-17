import type { ProviderHealth, ProviderProfile } from "../host/client";

/**
 * Model-first chat identity. Conversations are addressed to models; the CLI or
 * API endpoint behind a model is a connection managed in Settings, so chat
 * surfaces must never label the counterpart with connection names like
 * "Codex CLI".
 */
export type ChatModel = {
  /** Value sent as `model` on the run. */
  id: string;
  providerId: string;
  /** Backing connection label, shown only as small print ("via Codex CLI"). */
  connectionLabel: string;
  /** Whether the connection is usable right now (CLI found / key present). */
  available: boolean;
  providerType: string;
};

/** Used when a profile carries no model list yet (fresh or legacy database). */
const FALLBACK_MODELS: Record<string, string[]> = {
  codex: ["gpt-5.4-codex", "gpt-5.4", "gpt-5.4-mini"],
  claude: ["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-6"],
  grok: ["grok-4", "grok-4-fast", "grok-code-fast-1"],
  openai: ["gpt-5.4", "gpt-5.4-mini"],
  anthropic: ["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-6"],
  xai: ["grok-4", "grok-4-fast"],
};

function candidateModelsOf(profile: ProviderProfile): string[] {
  const fromConfig = profile.config.candidateModels;
  const list = Array.isArray(fromConfig) ? fromConfig.filter(isModelId) : [];
  const ids = profile.model ? [profile.model, ...list] : list;
  const unique = Array.from(new Set(ids));
  return unique.length ? unique : (FALLBACK_MODELS[profile.id] ?? []);
}

function isModelId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Flat, deduplicated model catalog across every configured connection. */
export function buildChatModels(
  profiles: ProviderProfile[],
  providers: ProviderHealth[],
): ChatModel[] {
  const healthById = new Map(providers.map((provider) => [provider.id, provider]));
  const seen = new Set<string>();
  const models: ChatModel[] = [];
  for (const profile of profiles) {
    if (!profile.enabled) continue;
    const health = healthById.get(profile.id);
    for (const id of candidateModelsOf(profile)) {
      const key = `${profile.id}:${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      models.push({
        id,
        providerId: profile.id,
        connectionLabel: profile.displayName,
        available: health?.available ?? false,
        providerType: profile.providerType,
      });
    }
  }
  // Usable connections first so the picker leads with what can answer.
  return models.sort((a, b) => Number(b.available) - Number(a.available));
}

/**
 * The label the chat counterpart goes by. Falls back to the connection's
 * default model — never to the CLI display name.
 */
export function chatModelLabel(
  model: string | undefined,
  providerId: string,
  profiles: ProviderProfile[],
): string {
  const trimmed = model?.trim();
  if (trimmed) return trimmed;
  const profile = profiles.find((item) => item.id === providerId);
  return profile ? (candidateModelsOf(profile)[0] ?? "") : "";
}
