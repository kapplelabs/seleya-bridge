import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { bridgeHome } from "../config.ts";
import { getProviderMeta } from "./catalog.ts";

export interface StoredConnection {
  id: string;
  providerId: string;
  name: string;
  apiKey: string;
  priority: number;
  isActive: boolean;
  modelIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SanitizedConnection {
  id: string;
  providerId: string;
  name: string;
  priority: number;
  isActive: boolean;
  modelIds: string[];
  maskedKey: string;
  createdAt: string;
  updatedAt: string;
}

function providersFilePath(): string {
  return path.join(bridgeHome(), "providers.json");
}

function maskApiKey(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return "••••••••";
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

export function sanitizeConnection(conn: StoredConnection): SanitizedConnection {
  return {
    id: conn.id,
    providerId: conn.providerId,
    name: conn.name,
    priority: conn.priority,
    isActive: conn.isActive,
    modelIds: conn.modelIds,
    maskedKey: maskApiKey(conn.apiKey),
    createdAt: conn.createdAt,
    updatedAt: conn.updatedAt,
  };
}

export class ProviderStore {
  private connections: StoredConnection[] = [];

  constructor() {
    this.load();
  }

  private load(): void {
    const file = providersFilePath();
    if (!existsSync(file)) {
      this.connections = [];
      return;
    }
    try {
      const data = JSON.parse(readFileSync(file, "utf8"));
      this.connections = Array.isArray(data) ? data : [];
    } catch {
      this.connections = [];
    }
  }

  private save(): void {
    const dir = bridgeHome();
    mkdirSync(dir, { recursive: true });
    const file = providersFilePath();
    writeFileSync(file, JSON.stringify(this.connections, null, 2), "utf8");
    try {
      chmodSync(file, 0o600);
    } catch {}
  }

  public getConnections(): StoredConnection[] {
    return this.connections;
  }

  public getSanitizedConnections(): SanitizedConnection[] {
    return this.connections.map(sanitizeConnection);
  }

  public getConnection(id: string): StoredConnection | undefined {
    return this.connections.find((c) => c.id === id);
  }

  public getActiveConnectionsByProvider(providerId: string): StoredConnection[] {
    return this.connections.filter((c) => c.providerId === providerId && c.isActive);
  }

  public async testKey(
    providerId: string,
    apiKey: string,
    customBaseUrl?: string,
  ): Promise<{ ok: boolean; models: string[]; error?: string }> {
    const meta = getProviderMeta(providerId);
    if (!meta) {
      return { ok: false, models: [], error: `Provider ${providerId} not found in catalog` };
    }

    const defaultModelIds = meta.models.map((m) => m.id);
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
    };

    if (meta.format === "claude") {
      headers["x-api-key"] = apiKey;
      headers["anthropic-version"] = "2023-06-01";
    } else {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    // Try fetching /models
    let modelsUrl = meta.modelsFetcherUrl;
    if (!modelsUrl) {
      const base = (customBaseUrl || meta.baseUrl || "").trim();
      if (base.endsWith("/chat/completions")) {
        modelsUrl = base.replace(/\/chat\/completions$/, "/models");
      } else if (base.endsWith("/v1/messages")) {
        modelsUrl = base.replace(/\/v1\/messages$/, "/v1/models");
      } else if (base.includes("/v1")) {
        modelsUrl = base.replace(/\/v1.*$/, "/v1/models");
      } else if (base) {
        modelsUrl = `${base.replace(/\/+$/, "")}/models`;
      }
    }

    if (modelsUrl) {
      try {
        const res = await fetch(modelsUrl, {
          method: "GET",
          headers,
          signal: AbortSignal.timeout(10000),
        });

        if (res.ok) {
          const data = (await res.json()) as any;
          const rawList = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
          const fetchedIds = rawList
            .map((item: any) => (typeof item === "string" ? item : item?.id))
            .filter((id: any): id is string => typeof id === "string" && id.length > 0);

          if (fetchedIds.length > 0) {
            return { ok: true, models: fetchedIds };
          }
        }
      } catch (err: any) {
        // Fall through to fallback test or default catalog
      }
    }

    // If models endpoint failed or returned empty, do a minimal completion probe
    const completionUrl = (customBaseUrl || meta.baseUrl || "").trim();
    if (completionUrl) {
      try {
        const testModel = defaultModelIds[0] || "gpt-3.5-turbo";
        const body =
          meta.format === "claude"
            ? {
                model: testModel,
                max_tokens: 1,
                messages: [{ role: "user", content: "hi" }],
              }
            : {
                model: testModel,
                max_tokens: 1,
                messages: [{ role: "user", content: "hi" }],
              };

        const res = await fetch(completionUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(12000),
        });

        if (res.ok || res.status === 400 || res.status === 429) {
          // 200, 400 (e.g. invalid param) or 429 (rate limit) means the key was accepted by the gateway!
          return {
            ok: true,
            models: defaultModelIds.length > 0 ? defaultModelIds : [testModel],
          };
        } else if (res.status === 401 || res.status === 403) {
          return { ok: false, models: [], error: `Authentication failed (HTTP ${res.status})` };
        }
      } catch (err: any) {
        // Network timeout / connection error
        return { ok: false, models: [], error: err.message || "Failed to reach provider" };
      }
    }

    // Default fallback if default models exist
    if (defaultModelIds.length > 0) {
      return { ok: true, models: defaultModelIds };
    }

    return { ok: false, models: [], error: "Could not verify credentials with provider" };
  }

  public async addConnection(input: {
    providerId: string;
    name?: string;
    apiKey: string;
    priority?: number;
    customBaseUrl?: string;
  }): Promise<StoredConnection> {
    const meta = getProviderMeta(input.providerId);
    const testResult = await this.testKey(input.providerId, input.apiKey, input.customBaseUrl);

    const modelIds =
      testResult.models.length > 0
        ? testResult.models
        : meta?.models.map((m) => m.id) || [];

    const now = new Date().toISOString();
    const newConn: StoredConnection = {
      id: `conn-${input.providerId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      providerId: input.providerId,
      name: input.name?.trim() || `${meta?.name || input.providerId} Key`,
      apiKey: input.apiKey.trim(),
      priority: input.priority ?? 1,
      isActive: true,
      modelIds,
      createdAt: now,
      updatedAt: now,
    };

    this.connections.push(newConn);
    this.save();
    return newConn;
  }

  public updateConnection(
    id: string,
    patch: Partial<Pick<StoredConnection, "name" | "priority" | "isActive" | "apiKey">>,
  ): StoredConnection | undefined {
    const conn = this.getConnection(id);
    if (!conn) return undefined;

    if (patch.name !== undefined) conn.name = patch.name;
    if (patch.priority !== undefined) conn.priority = patch.priority;
    if (patch.isActive !== undefined) conn.isActive = patch.isActive;
    if (patch.apiKey !== undefined && patch.apiKey.trim()) {
      conn.apiKey = patch.apiKey.trim();
    }
    conn.updatedAt = new Date().toISOString();
    this.save();
    return conn;
  }

  public deleteConnection(id: string): boolean {
    const prevLen = this.connections.length;
    this.connections = this.connections.filter((c) => c.id !== id);
    if (this.connections.length !== prevLen) {
      this.save();
      return true;
    }
    return false;
  }
}
