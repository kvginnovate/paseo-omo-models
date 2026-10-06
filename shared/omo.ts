import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** Reasoning rungs accepted by omo.jsonc (`reasoning` / `reasoningEffort`). */
export const REASONING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "auto",
] as const;

export const roleKindSchema = z.enum(["agent", "category"]);

export const roleSchema = z.object({
  kind: roleKindSchema,
  name: z.string(),
  /** `model` member, or null when the role only declares a `models` fallback chain. */
  model: z.string().nullable(),
  reasoning: z.string().nullable(),
  /** `models` fallback chain, flattened to selectors. */
  fallbackModels: z.array(z.string()),
});

export const sectionSchema = z.object({
  /** "" for the root document, otherwise the raw section key such as "[opencode]". */
  id: z.string(),
  label: z.string(),
  modelProfile: z.string().nullable(),
  roles: z.array(roleSchema),
});

export const modelOptionSchema = z.object({
  selector: z.string(),
  label: z.string(),
  /** Listed in omo's settings.json `enabledModels`. */
  enabled: z.boolean(),
});

export const omoStateSchema = z.object({
  path: z.string(),
  exists: z.boolean(),
  /** Set when omo.jsonc is not valid JSONC; editing is refused while it is set. */
  parseError: z.string().nullable(),
  sections: z.array(sectionSchema),
  models: z.array(modelOptionSchema),
  reasoningLevels: z.array(z.string()),
  warnings: z.array(z.string()),
  canUndo: z.boolean(),
});

export const omoStateRpc = defineRpc({
  name: "omo.state",
  input: z.object({}),
  output: omoStateSchema,
});

export const omoApplyRpc = defineRpc({
  name: "omo.apply",
  input: z.object({
    /** "" for the root document, otherwise the raw section key. */
    section: z.string(),
    kind: z.union([roleKindSchema, z.literal("model_profile")]),
    /** Role name; ignored for `model_profile`. */
    name: z.string(),
    model: z.string().nullable(),
    reasoning: z.string().nullable(),
  }),
  output: z.object({
    state: omoStateSchema,
    changed: z.boolean(),
    message: z.string(),
  }),
});

export const omoUndoRpc = defineRpc({
  name: "omo.undo",
  input: z.object({}),
  output: z.object({
    state: omoStateSchema,
    message: z.string(),
  }),
});

export type OmoState = z.output<typeof omoStateSchema>;
export type OmoRole = z.output<typeof roleSchema>;
export type OmoSection = z.output<typeof sectionSchema>;
export type OmoModelOption = z.output<typeof modelOptionSchema>;
export type OmoApplyInput = z.output<typeof omoApplyRpc.input>;
