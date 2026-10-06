import { readFile } from "node:fs/promises";
import path from "node:path";
import type { OmoModelOption } from "../shared/omo.js";
import { omoAgentDir } from "./omo-config.js";

interface StoredModel {
  id?: unknown;
  name?: unknown;
}

interface StoredProvider {
  models?: unknown;
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Selectors the user enabled in omo's own settings.json. */
async function readEnabledModels(): Promise<string[]> {
  const settings = await readJson(path.join(omoAgentDir(), "settings.json"));
  if (!isRecord(settings)) return [];
  const enabled = settings.enabledModels;
  if (!Array.isArray(enabled)) return [];
  return enabled.filter((entry): entry is string => typeof entry === "string");
}

/** Provider/model catalog from omo's models-store.json, keyed by `<provider>/<id>`. */
async function readStoredModels(): Promise<Map<string, string>> {
  const store = await readJson(path.join(omoAgentDir(), "models-store.json"));
  const found = new Map<string, string>();
  if (!isRecord(store)) return found;
  for (const [provider, value] of Object.entries(store)) {
    if (!isRecord(value)) continue;
    const models = (value as StoredProvider).models;
    if (!Array.isArray(models)) continue;
    for (const entry of models) {
      if (!isRecord(entry)) continue;
      const model = entry as StoredModel;
      if (typeof model.id !== "string" || model.id.length === 0) continue;
      const selector = `${provider}/${model.id}`;
      found.set(selector, typeof model.name === "string" && model.name.length > 0 ? model.name : selector);
    }
  }
  return found;
}

/**
 * Model choices for the picker: omo's enabled list, its stored catalog, and any
 * selector already referenced by omo.jsonc (so pinned-but-unlisted models stay editable).
 */
export async function listModelOptions(current: readonly string[]): Promise<OmoModelOption[]> {
  const [enabled, stored] = await Promise.all([readEnabledModels(), readStoredModels()]);
  const enabledSet = new Set(enabled);
  const options = new Map<string, OmoModelOption>();

  const add = (selector: string, label: string): void => {
    if (options.has(selector)) return;
    options.set(selector, { selector, label, enabled: enabledSet.has(selector) });
  };

  for (const selector of enabled) add(selector, stored.get(selector) ?? selector);
  for (const [selector, label] of stored) add(selector, label);
  for (const selector of current) add(selector, stored.get(selector) ?? selector);

  return [...options.values()].sort((left, right) => {
    if (left.enabled !== right.enabled) return left.enabled ? -1 : 1;
    return left.selector.localeCompare(right.selector);
  });
}
