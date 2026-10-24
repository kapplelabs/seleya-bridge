import { useEffect, useState } from "react";

import type { BridgeSettings } from "../../shared/ipc.ts";

export const KNOWN_TOOLS = [
  { name: "Read", description: "Read files in the workspace" },
  { name: "Glob", description: "Find files by name" },
  { name: "Grep", description: "Search inside files" },
  { name: "WebFetch", description: "Open web pages" },
  { name: "WebSearch", description: "Search the web" },
] as const;

/** Same rule as the bridge's config: scheme://host[:port], nothing after it. */
export function originError(value: string): string | undefined {
  try {
    if (new URL(value).origin === value && /^https?:/.test(value)) return undefined;
  } catch {
    // Not a URL at all.
  }
  return "Use an address like https://seleya.example.com, without a path or trailing slash.";
}

type Notice = { tone: "success" | "error"; text: string };

export function useSettings() {
  const [saved, setSaved] = useState<BridgeSettings>();
  const [draft, setDraft] = useState<BridgeSettings>();
  const [newOrigin, setNewOrigin] = useState("");
  const [originProblem, setOriginProblem] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice>();
  const [loadError, setLoadError] = useState<string>();

  useEffect(() => {
    window.bridge
      .getSettings()
      .then((settings) => {
        setSaved(settings);
        setDraft(settings);
      })
      .catch((error: unknown) => setLoadError(error instanceof Error ? error.message : String(error)));
  }, []);

  const dirty = saved !== undefined && draft !== undefined && JSON.stringify(saved) !== JSON.stringify(draft);

  const update = (patch: Partial<BridgeSettings>) => {
    setNotice(undefined);
    setDraft((current) => current && { ...current, ...patch });
  };

  const addOrigin = () => {
    const value = newOrigin.trim().replace(/\/+$/, "");
    const problem = originError(value);
    if (problem) return setOriginProblem(problem);
    if (draft && !draft.allowedOrigins.includes(value)) update({ allowedOrigins: [...draft.allowedOrigins, value] });
    setNewOrigin("");
    setOriginProblem(undefined);
  };

  const removeOrigin = (origin: string) =>
    draft && update({ allowedOrigins: draft.allowedOrigins.filter((item) => item !== origin) });

  const toggleTool = (tool: string, enabled: boolean) =>
    draft &&
    update({ tools: enabled ? [...draft.tools, tool] : draft.tools.filter((item) => item !== tool) });

  const chooseWorkspace = async () => {
    const folder = await window.bridge.chooseWorkspace();
    if (folder) update({ workspace: folder });
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    const result = await window.bridge.saveSettings(draft);
    setSaving(false);
    if (result.ok) {
      setSaved(draft);
      setNotice({ tone: "success", text: "Saved. The bridge restarted with the new settings." });
    } else setNotice({ tone: "error", text: result.message });
  };

  const discard = () => {
    setDraft(saved);
    setNotice(undefined);
  };

  return {
    draft,
    loadError,
    dirty,
    saving,
    notice,
    newOrigin,
    setNewOrigin: (value: string) => {
      setNewOrigin(value);
      setOriginProblem(undefined);
    },
    originProblem,
    update,
    addOrigin,
    removeOrigin,
    toggleTool,
    chooseWorkspace,
    save,
    discard,
  };
}
