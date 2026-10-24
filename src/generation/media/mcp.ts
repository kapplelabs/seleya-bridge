/**
 * MCP servers the person connected to Claude Code that make media (an image generator such as
 * fal, Replicate, Flux, Imagen or DALL·E). Whatever the person provides is used: an agent without
 * its own image tool can make pictures through one. Claude Code runs isolated from the person's MCP
 * servers (`--strict-mcp-config`); a media job gets exactly these servers and nothing else.
 *
 * Found by name or command (IMAGE_HINTS), or declared in `<home>/capabilities.json`:
 *   {"mcp": {"<server name>": ["image"]}}
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { mediaKinds } from "./catalog.ts";

/** Words in an MCP server's name, command or URL that say it makes images. */
const IMAGE_HINTS =
  /image|imagen|dall-?e|flux|stable-?diffusion|stability|sdxl|midjourney|ideogram|replicate|\bfal\b|fal-ai|fal\.ai|recraft|leonardo|nano-?banana|gpt-image/i;

export type McpServer = Record<string, unknown>;

/** The person's user-scope MCP servers for Claude Code (`~/.claude.json`), by name. */
export function claudeMcpServers(file = path.join(homedir(), ".claude.json")): Record<string, McpServer> {
  if (!existsSync(file)) return {};
  try {
    const servers = (JSON.parse(readFileSync(file, "utf8")) as { mcpServers?: unknown }).mcpServers;
    return servers && typeof servers === "object" ? (servers as Record<string, McpServer>) : {};
  } catch {
    return {};
  }
}

/** `capabilities.json`'s `mcp` part: server name → media kinds. */
export function declaredMcp(home: string): Record<string, string[]> {
  const file = path.join(home, "capabilities.json");
  if (!existsSync(file)) return {};
  try {
    const mcp = (JSON.parse(readFileSync(file, "utf8")) as { mcp?: unknown }).mcp;
    if (!mcp || typeof mcp !== "object") return {};
    return Object.fromEntries(Object.entries(mcp).map(([name, kinds]) => [name, mediaKinds(kinds)]));
  } catch {
    return {};
  }
}

/** The servers that make `kind`: declared ones, and (for images) ones whose name or command says so. */
export function mediaMcpServers(
  kind: string,
  servers: Record<string, McpServer>,
  declared: Record<string, string[]> = {},
): Record<string, McpServer> {
  return Object.fromEntries(
    Object.entries(servers).filter(([name, server]) => {
      if (declared[name]) return declared[name].includes(kind);
      if (kind !== "image") return false;
      const said = [name, server.command, server.url, ...(Array.isArray(server.args) ? server.args : [])]
        .filter((item): item is string => typeof item === "string")
        .join(" ");
      return IMAGE_HINTS.test(said);
    }),
  );
}

/** Media kinds Claude Code can make through the person's MCP servers. */
export function claudeMcpKinds(home: string, servers = claudeMcpServers()): string[] {
  const declared = declaredMcp(home);
  return ["image", "video", "audio"].filter((kind) => Object.keys(mediaMcpServers(kind, servers, declared)).length);
}
