function readNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function readString(name: string): string | undefined {
  const raw = process.env[name]?.trim();
  return raw ? raw : undefined;
}

function normalizeModel(model: string): string {
  const knownAliases: Record<string, string> = {
    "anthropic/claude-sonnet-4-6": "anthropic/claude-sonnet-4.6",
    "anthropic/claude-opus-4-6": "anthropic/claude-opus-4.6",
    "anthropic/claude-3.5-sonnet": "anthropic/claude-sonnet-4.6",
    "claude-3-5-sonnet-latest": "anthropic/claude-sonnet-4.6",
    "claude-3.5-sonnet-latest": "anthropic/claude-sonnet-4.6",
    "claude-3-5-sonnet": "anthropic/claude-sonnet-4.6",
    "claude-3.5-sonnet": "anthropic/claude-sonnet-4.6",
    "claude-sonnet-4-6": "anthropic/claude-sonnet-4.6",
    "claude-sonnet-4.6": "anthropic/claude-sonnet-4.6",
    "claude-sonnet-4.5": "anthropic/claude-sonnet-4.5",
    "claude-opus-4-6": "anthropic/claude-opus-4.6",
    "claude-opus-4.6": "anthropic/claude-opus-4.6",
    "claude-opus-4-5": "anthropic/claude-opus-4.5",
    "claude-opus-4.5": "anthropic/claude-opus-4.5",
  };

  if (knownAliases[model]) return knownAliases[model];
  if (model.includes("/")) return model;
  return knownAliases[model] ?? `anthropic/${model}`;
}

const config = {
  model: normalizeModel(process.env.OPEN_ROUTER_MODEL ?? process.env.ANTHROPIC_MODEL ?? "anthropic/claude-sonnet-4.6"),
  maxTokens: readNumber("BRAIN_MAX_TOKENS", 2500),
  intervalMinutes: readNumber("BRAIN_INTERVAL_MINUTES", 30),
  verboseThoughts: readBoolean("BRAIN_VERBOSE_THOUGHTS", true),
  useSystemNotifications: readBoolean("BRAIN_USE_SYSTEM_NOTIFICATIONS", false),
  openRouterBaseUrl: readString("OPEN_ROUTER_BASE_URL") ?? "https://openrouter.ai/api/v1/messages",
  openRouterReferer: readString("OPEN_ROUTER_HTTP_REFERER"),
  openRouterTitle: readString("OPEN_ROUTER_TITLE") ?? "brain",
  requireAnthropicProvider: readBoolean("OPEN_ROUTER_REQUIRE_ANTHROPIC", true),
};

export default config;
