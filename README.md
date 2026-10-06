# omo-models

A [Paseo](https://paseo.sh) plugin for editing OmO model routing from the app UI, instead of hand-editing `~/.omo/omo.jsonc`.

## What it does

Reads the OmO config document and exposes every routing decision as rows you can change directly:

- **`model_profile`** for the root document and for each `[edition]` section
- **Per-agent and per-category `model`** rows
- **Per-agent and per-category `reasoning`** rows (`off` … `max`)

Each change is written to disk immediately and reports whether it changed anything.

## Comment-preserving edits

`omo.jsonc` is JSONC and its comments carry real decisions (which model is pinned, why paid
rungs were removed). The plugin does **not** parse-and-re-serialize the file. `server/jsonc.ts`
parses to a tree that keeps byte offsets, and each edit replaces only the target value's span:

```jsonc
"explore": {
  "model": "opencode/space-bunny-free",
  "reasoning": "low"
}
```

Editing `reasoning` rewrites exactly `"low"` → `"high"`. Everything else in the file, including
every comment and blank line, is byte-identical afterwards. Writes are atomic (temp file plus
rename), and the plugin keeps the previous text in memory so **Undo** in the Maintenance section
can revert the last change.

## Model options

The picker does not guess selectors. It offers the union of:

1. `~/.omo/agent/settings.json` → `enabledModels` (your curated list, marked `· enabled`)
2. `~/.omo/agent/models-store.json` → `<provider>/<id>` across all stored providers
3. any selector already referenced by `omo.jsonc`, so pinned-but-unlisted models stay editable

`models-store.json` is a cache that OmO's model extensions rewrite on launch. It is only ever
read here; the plugin never writes it.

Override the file locations with `OMO_CONFIG` and `OMO_AGENT_DIR` if your setup differs.

## Requirements

`paseo: ">=0.10.3"`. The client surface deliberately sticks to APIs proven on that release:
`addSurface`, `addSidebarItem`, `addSettingsScreen`, `addCommandCenterItem`, and Paseo's own
`Settings*` components. Newer-only surfaces (`addScreen`, `addSidebarHeaderItem`, plugin
`Modal`) are deliberately unused, so the plugin also runs on older mobile clients.

## Install

```bash
git clone https://github.com/kvginnovate/paseo-omo-models.git
cd paseo-omo-models
npm install
paseo plugin install /absolute/path/to/paseo-omo-models
```

Then open it from the left nav (**omo models**), **Settings → Plugins → omo.jsonc models**, or
**Ctrl+K** → "Edit omo.jsonc models".

After editing the source, reload with `paseo plugin reload omo-models` and read backend output
with `paseo plugin logs omo-models`. Do not restart the daemon; it can kill the agent you are
working from.

## Scope

Edits existing roles. It does not create new agent or category entries, and it refuses to write
while the document fails to parse (the reason is shown in the header).

## Security

Plugin code is trusted and unsandboxed. The server half of this plugin reads and writes your
OmO config and reads two JSON files under `~/.omo/agent/`. It makes no network calls and holds
no credentials.