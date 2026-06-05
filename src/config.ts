import "dotenv/config";

/**
 * Central runtime configuration. Every external dependency is optional so the
 * tool runs end-to-end offline; presence of a key flips a subsystem to "live".
 */
export interface MomentumConfig {
  github: {
    username: string;
    token?: string;
    /** Optional allow-list of repo names to analyze (demo focus). */
    repos: string[];
  };
  butterbase: {
    apiUrl: string;
    appId?: string;
    apiKey?: string;
    model: string;
    /** live === we can call the AI gateway and/or data API */
    live: boolean;
  };
  xtrace: {
    apiKey?: string;
    orgId: string;
    live: boolean;
  };
  spectrum: {
    projectId?: string;
    projectSecret?: string;
    providers: string[];
    digestTo?: string;
    live: boolean;
  };
  rocketride: {
    engineUrl: string;
    apiKey: string;
  };
}

function csv(value: string | undefined, fallback: string[]): string[] {
  if (!value) return fallback;
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function loadConfig(): MomentumConfig {
  const butterbaseAppId = process.env.BUTTERBASE_APP_ID || undefined;
  const butterbaseApiKey = process.env.BUTTERBASE_API_KEY || undefined;

  return {
    github: {
      username: process.env.GITHUB_USERNAME || "octocat",
      token: process.env.GITHUB_TOKEN || undefined,
      repos: csv(process.env.GITHUB_REPOS, []),
    },
    butterbase: {
      apiUrl: process.env.BUTTERBASE_API_URL || "https://api.butterbase.ai",
      appId: butterbaseAppId,
      apiKey: butterbaseApiKey,
      model: process.env.MOMENTUM_MODEL || "anthropic/claude-sonnet-4.6",
      live: Boolean(butterbaseApiKey),
    },
    xtrace: {
      apiKey: process.env.XTRACE_API_KEY || undefined,
      orgId: process.env.XTRACE_ORG_ID || "momentum",
      live: Boolean(process.env.XTRACE_API_KEY),
    },
    spectrum: {
      projectId: process.env.SPECTRUM_PROJECT_ID || undefined,
      projectSecret: process.env.SPECTRUM_PROJECT_SECRET || undefined,
      providers: csv(process.env.SPECTRUM_PROVIDERS, ["terminal"]),
      digestTo: process.env.SPECTRUM_DIGEST_TO || undefined,
      live: Boolean(process.env.SPECTRUM_PROJECT_ID && process.env.SPECTRUM_PROJECT_SECRET),
    },
    rocketride: {
      engineUrl: process.env.ROCKETRIDE_ENGINE_URL || "http://localhost:5565",
      // Local engine uses the literal key "api_key"; cloud uses a real key.
      apiKey: process.env.ROCKETRIDE_APIKEY || "api_key",
    },
  };
}

/** Pretty one-line status of which subsystems are live vs offline. */
export function describeMode(cfg: MomentumConfig): string {
  const flag = (live: boolean) => (live ? "live" : "offline");
  return [
    `github=${cfg.github.token ? "live(auth)" : "live(anon)"}`,
    `butterbase=${flag(cfg.butterbase.live)}`,
    `xtrace=${flag(cfg.xtrace.live)}`,
    `spectrum=${cfg.spectrum.live ? `live(${cfg.spectrum.providers.join("+")})` : "terminal"}`,
  ].join("  ");
}
