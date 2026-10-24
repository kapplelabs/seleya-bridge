import { FileJson, FolderOpen, Plus, X } from "lucide-react";

import type { BridgeState } from "../../shared/ipc.ts";
import { Button, Card, cn, inputClass, Switch } from "./ui.tsx";
import { KNOWN_TOOLS, useSettings } from "./useSettings.ts";

export function SettingsPanel({ state }: { state: BridgeState }) {
  const settings = useSettings();
  const { draft } = settings;

  if (settings.loadError)
    return (
      <Card id="settings-error" title="Couldn't read config.json">
        <p className="text-sm text-destructive">{settings.loadError}</p>
        <Button className="mt-3" onClick={() => void window.bridge.openConfigFile()}>
          <FileJson aria-hidden="true" />
          Open config.json
        </Button>
      </Card>
    );
  if (!draft) return <div className="skeleton h-40 rounded-2xl" aria-busy="true" />;

  const customTools = draft.tools.filter((tool) => !KNOWN_TOOLS.some((known) => known.name === tool));
  const customConnectors = typeof draft.connectors === "object" ? draft.connectors : undefined;

  return (
    <form
      id="settings-form"
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void settings.save();
      }}
    >
      <Card id="settings-origins" title="Seleya addresses">
        <p className="-mt-2 mb-3 text-xs text-muted-foreground">
          Only Seleya pages at these addresses can use the bridge.
        </p>
        <ul className="mb-3 flex flex-col gap-1.5">
          {draft.allowedOrigins.map((origin) => (
            <li key={origin} className="flex items-center gap-2 rounded-xl bg-muted px-3 py-1.5 text-sm">
              <span className="min-w-0 flex-1 truncate select-text">{origin}</span>
              <Button
                size="icon"
                variant="ghost"
                className="size-7"
                aria-label={`Remove ${origin}`}
                onClick={() => settings.removeOrigin(origin)}
              >
                <X aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
        <label htmlFor="new-origin" className="sr-only">
          Add a Seleya address
        </label>
        <div className="flex gap-2">
          <input
            id="new-origin"
            className={inputClass}
            placeholder="https://seleya.example.com"
            value={settings.newOrigin}
            onChange={(event) => settings.setNewOrigin(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              settings.addOrigin();
            }}
            aria-invalid={settings.originProblem !== undefined}
            aria-describedby={settings.originProblem ? "new-origin-error" : undefined}
            spellCheck={false}
            autoCapitalize="off"
          />
          <Button onClick={settings.addOrigin} disabled={!settings.newOrigin.trim()}>
            <Plus aria-hidden="true" />
            Add
          </Button>
        </div>
        {settings.originProblem && (
          <p id="new-origin-error" className="mt-1.5 text-xs text-destructive">
            {settings.originProblem}
          </p>
        )}
      </Card>

      <Card id="settings-workspace" title="Workspace folder">
        <p className="-mt-2 mb-3 text-xs text-muted-foreground">Claude works in this folder and can't read outside it.</p>
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate rounded-xl bg-muted px-3 py-2.5 font-mono text-xs select-text" title={draft.workspace}>
            {draft.workspace}
          </span>
          <Button onClick={() => void settings.chooseWorkspace()}>
            <FolderOpen aria-hidden="true" />
            Choose…
          </Button>
        </div>
      </Card>

      <Card id="settings-tools" title="Tools Claude may use">
        <fieldset className="flex flex-col gap-1">
          <legend className="sr-only">Tools Claude may use</legend>
          {KNOWN_TOOLS.map((tool) => (
            <label key={tool.name} className="flex items-center gap-3 rounded-lg px-1 py-1.5 hover:bg-muted">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={draft.tools.includes(tool.name)}
                onChange={(event) => settings.toggleTool(tool.name, event.target.checked)}
              />
              <span className="text-sm font-medium">{tool.name}</span>
              <span className="text-xs text-muted-foreground">{tool.description}</span>
            </label>
          ))}
        </fieldset>
        {customTools.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">Also from config.json: {customTools.join(", ")}</p>
        )}
      </Card>

      <Card id="settings-connectors" title="Connectors">
        {customConnectors ? (
          <>
            <p className="text-sm text-muted-foreground">
              config.json lists them by hand: {Object.values(customConnectors).join(", ")}.
            </p>
            <Button size="sm" className="mt-3" onClick={() => void window.bridge.openConfigFile()}>
              <FileJson aria-hidden="true" />
              Edit config.json
            </Button>
          </>
        ) : (
          <fieldset className="flex flex-col gap-1">
            <legend className="sr-only">Which connectors Claude can read</legend>
            {(
              [
                ["auto", "Every connector connected in claude.ai", "Read-only: Claude can't send, create or delete."],
                ["none", "None", "Claude only sees the workspace folder."],
              ] as const
            ).map(([value, label, hint]) => (
              <label key={value} className="flex items-start gap-3 rounded-lg px-1 py-1.5 hover:bg-muted">
                <input
                  type="radio"
                  name="connectors"
                  className="mt-0.5 size-4 accent-primary"
                  checked={draft.connectors === value}
                  onChange={() => settings.update({ connectors: value })}
                />
                <span className="flex flex-col">
                  <span className="text-sm font-medium">{label}</span>
                  <span className="text-xs text-muted-foreground">{hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
        )}
      </Card>

      <Card id="settings-model" title="Model">
        <label htmlFor="model" className="sr-only">
          Model
        </label>
        <input
          id="model"
          className={inputClass}
          placeholder="Claude Code's default"
          value={draft.model ?? ""}
          onChange={(event) => settings.update({ model: event.target.value || undefined })}
          spellCheck={false}
          autoCapitalize="off"
        />
      </Card>

      <Card id="settings-login">
        <Switch
          id="open-at-login"
          checked={state.openAtLogin}
          onChange={(enabled) => void window.bridge.setOpenAtLogin(enabled)}
          label="Start at login"
          description="Keep the bridge ready in the menu bar whenever you use this Mac."
        />
      </Card>

      <button
        type="button"
        onClick={() => void window.bridge.openConfigFile()}
        className="self-start rounded-md px-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:underline"
      >
        Open config.json · port {draft.port}
      </button>

      <div
        id="settings-actions"
        className="sticky bottom-0 -mx-4 mt-1 flex flex-col gap-2 border-t bg-background/90 px-4 py-3 backdrop-blur"
      >
        {settings.notice && (
          <p
            role="status"
            className={cn("text-xs", settings.notice.tone === "success" ? "text-success" : "text-destructive")}
          >
            {settings.notice.text}
          </p>
        )}
        <div className="flex gap-2">
          <Button type="submit" variant="primary" className="flex-1" disabled={!settings.dirty || settings.saving}>
            {settings.saving ? "Restarting…" : "Save and restart"}
          </Button>
          <Button onClick={settings.discard} disabled={!settings.dirty || settings.saving}>
            Discard
          </Button>
        </div>
      </div>
    </form>
  );
}
