import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { OmoApplyInput, OmoRole, OmoSection, OmoState } from "../shared/omo.js";
import { REASONING_LEVELS } from "../shared/omo.js";
import {
  JsoncParseError,
  memberOf,
  objectAt,
  parseJsonc,
  setMemberValue,
  type JsoncNode,
  type JsoncObject,
} from "./jsonc.js";
import { listModelOptions } from "./models.js";

const UNDO_LIMIT = 20;
const undoStack: string[] = [];

export function omoConfigPath(): string {
  const override = process.env.OMO_CONFIG?.trim();
  return override && override.length > 0 ? override : path.join(homedir(), ".omo", "omo.jsonc");
}

export function omoAgentDir(): string {
  const override = process.env.OMO_AGENT_DIR?.trim();
  return override && override.length > 0 ? override : path.join(homedir(), ".omo", "agent");
}

function stringMember(node: JsoncNode, key: string): string | null {
  const member = memberOf(node, key);
  if (!member || member.value.type !== "string") return null;
  return member.value.value;
}

function fallbackModels(node: JsoncNode): string[] {
  const member = memberOf(node, "models");
  if (!member || member.value.type !== "array") return [];
  const selectors: string[] = [];
  for (const element of member.value.elements) {
    if (element.type === "string") {
      selectors.push(element.value);
      continue;
    }
    const model = element.type === "object" ? stringMember(element, "model") : null;
    if (model) selectors.push(model);
  }
  return selectors;
}

function readRoles(section: JsoncNode, kind: OmoRole["kind"]): OmoRole[] {
  const group = objectAt(section, [kind === "agent" ? "agents" : "categories"]);
  if (!group) return [];
  const roles: OmoRole[] = [];
  for (const member of group.members) {
    if (member.value.type !== "object") continue;
    roles.push({
      kind,
      name: member.key,
      model: stringMember(member.value, "model"),
      reasoning: stringMember(member.value, "reasoning"),
      fallbackModels: fallbackModels(member.value),
    });
  }
  return roles;
}

function readSection(id: string, label: string, node: JsoncNode): OmoSection {
  return {
    id,
    label,
    modelProfile: stringMember(node, "model_profile"),
    roles: [...readRoles(node, "agent"), ...readRoles(node, "category")],
  };
}

function parseRoot(text: string): JsoncObject {
  const root = parseJsonc(text);
  if (root.type !== "object") {
    throw new JsoncParseError("The document root must be an object", root.start);
  }
  return root;
}

function collectSections(root: JsoncObject): OmoSection[] {
  const sections: OmoSection[] = [readSection("", "Default", root)];
  for (const member of root.members) {
    if (!/^\[.+\]$/.test(member.key) || member.value.type !== "object") continue;
    sections.push(readSection(member.key, member.key.slice(1, -1), member.value));
  }
  return sections;
}

function collectWarnings(sections: readonly OmoSection[]): string[] {
  const warnings: string[] = [];
  for (const section of sections) {
    for (const role of section.roles) {
      const where = section.id === "" ? role.name : `${section.id} ${role.name}`;
      if (role.model === null && role.fallbackModels.length > 0) {
        warnings.push(`${where}: no "model"; falls back to ${role.fallbackModels[0]}`);
      } else if (role.model === null) {
        warnings.push(`${where}: no model configured`);
      }
    }
  }
  return warnings;
}

async function readText(): Promise<{ text: string; exists: boolean }> {
  try {
    return { text: await readFile(omoConfigPath(), "utf8"), exists: true };
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return { text: "", exists: false };
    throw error;
  }
}

export async function readState(): Promise<OmoState> {
  const { text, exists } = await readText();
  const base = {
    path: omoConfigPath(),
    exists,
    models: await listModelOptions(collectCurrentModels(text)),
    reasoningLevels: [...REASONING_LEVELS],
    canUndo: undoStack.length > 0,
  };

  if (!exists) {
    return { ...base, parseError: null, sections: [], warnings: [] };
  }

  try {
    const sections = collectSections(parseRoot(text));
    return { ...base, parseError: null, sections, warnings: collectWarnings(sections) };
  } catch (error) {
    const message = error instanceof JsoncParseError ? error.message : String(error);
    return { ...base, parseError: message, sections: [], warnings: [] };
  }
}

/** Every model selector already referenced by the document, so the picker can offer them. */
function collectCurrentModels(text: string): string[] {
  if (text.trim().length === 0) return [];
  let root: JsoncObject;
  try {
    root = parseRoot(text);
  } catch {
    return [];
  }
  const selectors = new Set<string>();
  const profile = stringMember(root, "model_profile");
  if (profile) selectors.add(profile);
  for (const section of collectSections(root)) {
    if (section.modelProfile) selectors.add(section.modelProfile);
    for (const role of section.roles) {
      if (role.model) selectors.add(role.model);
      for (const fallback of role.fallbackModels) selectors.add(fallback);
    }
  }
  return [...selectors];
}

async function writeText(text: string): Promise<void> {
  const target = omoConfigPath();
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, text, "utf8");
  await rename(temporary, target);
}

function pushUndo(text: string): void {
  undoStack.push(text);
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
}

export interface ApplyResult {
  state: OmoState;
  changed: boolean;
  message: string;
}

export async function applyEdit(input: OmoApplyInput): Promise<ApplyResult> {
  const { text, exists } = await readText();
  const original = exists ? text : "{\n}\n";
  if (exists) {
    try {
      parseJsonc(original);
    } catch (error) {
      throw new Error(`omo.jsonc is not valid JSONC: ${error instanceof Error ? error.message : error}`);
    }
  }

  const sectionPath = input.section === "" ? [] : [input.section];
  let next = original;
  let changed = false;

  if (input.kind === "model_profile") {
    if (input.model === null) throw new Error("model_profile requires a model");
    const result = setMemberValue(next, sectionPath, "model_profile", JSON.stringify(input.model));
    next = result.text;
    changed = result.changed;
  } else if (input.kind === "all") {
    if (input.model === null && input.reasoning === null)
      throw new Error(`kind "all" requires a model, a reasoning, or both`);
    const sectionRoot = objectAt(parseJsonc(next), sectionPath);
    if (!sectionRoot) throw new Error(`No section at ${sectionPath.join(".") || "<root>"}`);
    const roleNames = [
      ...readRoles(sectionRoot, "agent"),
      ...readRoles(sectionRoot, "category"),
    ];
    for (const role of roleNames) {
      const group = role.kind === "agent" ? "agents" : "categories";
      const target = [...sectionPath, group, role.name];
      if (input.model !== null) {
        const result = setMemberValue(next, target, "model", JSON.stringify(input.model));
        next = result.text;
        changed = changed || result.changed;
      }
      if (input.reasoning !== null) {
        const reasoningResult = setMemberValue(
          next,
          target,
          "reasoning",
          JSON.stringify(input.reasoning),
        );
        next = reasoningResult.text;
        changed = changed || reasoningResult.changed;
      }
    }
  } else {
    const group = input.kind === "agent" ? "agents" : "categories";
    const target = [...sectionPath, group, input.name];
    if (input.model !== null) {
      const result = setMemberValue(next, target, "model", JSON.stringify(input.model));
      next = result.text;
      changed = changed || result.changed;
    }
    if (input.reasoning !== null) {
      const result = setMemberValue(next, target, "reasoning", JSON.stringify(input.reasoning));
      next = result.text;
      changed = changed || result.changed;
    }
  }

  if (!changed) {
    return { state: await readState(), changed: false, message: "No change" };
  }

  pushUndo(original);
  await writeText(next);
  const state = await readState();
  return { state, changed: true, message: `Saved ${path.basename(state.path)}` };
}

export async function undo(): Promise<{ state: OmoState; message: string }> {
  const previous = undoStack.pop();
  if (previous === undefined) {
    return { state: await readState(), message: "Nothing to undo" };
  }
  await writeText(previous);
  return { state: await readState(), message: "Reverted the last change" };
}
