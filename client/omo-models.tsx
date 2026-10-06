import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import {
  SettingsAction,
  SettingsCard,
  SettingsInput,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
} from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import {
  omoApplyRpc,
  omoStateRpc,
  omoUndoRpc,
  type OmoApplyInput,
  type OmoRole,
  type OmoSection,
  type OmoState,
} from "../shared/omo";

const STATE_KEY = ["omo-models", "state"] as const;
const MATCH_LIMIT = 40;

interface EditingTarget {
  section: string;
  sectionLabel: string;
  kind: OmoRole["kind"] | "model_profile";
  name: string;
}

export function OmoModelsScreen({ theme, layout }: PluginSurfaceProps) {
  const readState = useRpc(omoStateRpc);
  const applyEdit = useRpc(omoApplyRpc);
  const undoEdit = useRpc(omoUndoRpc);
  const queryClient = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<EditingTarget | null>(null);
  const [modelQuery, setModelQuery] = useState("");

  const query = useQuery({ queryKey: STATE_KEY, queryFn: () => readState({}) });
  const state: OmoState | undefined = query.data;

  const apply = useMutation({
    mutationFn: (edit: OmoApplyInput) => applyEdit(edit),
    onSuccess: (result) => {
      queryClient.setQueryData(STATE_KEY, result.state);
      toast.show(result.message, { variant: result.changed ? "success" : "info" });
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : String(error));
    },
  });

  const undo = useMutation({
    mutationFn: () => undoEdit({}),
    onSuccess: (result) => {
      queryClient.setQueryData(STATE_KEY, result.state);
      toast.show(result.message, { variant: "info" });
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : String(error));
    },
  });

  const styles = useMemo(
    () => ({
      scroll: { flex: 1, backgroundColor: theme.colors.surface0 },
      screen: {
        gap: layout.compact ? 12 : 16,
        padding: layout.compact ? 16 : 24,
        paddingBottom: layout.compact ? 32 : 48,
        backgroundColor: theme.colors.surface0,
      },
      title: { color: theme.colors.foreground, fontSize: layout.compact ? 18 : 20 },
      path: { color: theme.colors.foregroundMuted, fontSize: 12 },
      error: { color: theme.colors.statusDanger, fontSize: 13 },
    }),
    [theme, layout.compact],
  );

  const openEditor = (target: EditingTarget) => {
    setModelQuery("");
    setEditing(target);
  };

  if (query.isPending) {
    return (
      <ScrollView style={styles.scroll} contentContainerStyle={styles.screen}>
        <Text style={styles.path}>Reading omo.jsonc…</Text>
      </ScrollView>
    );
  }

  if (query.isError || !state) {
    return (
      <ScrollView style={styles.scroll} contentContainerStyle={styles.screen}>
        <Text style={styles.error}>
          {query.error instanceof Error ? query.error.message : "Could not read omo.jsonc"}
        </Text>
        <SettingsSection title="Maintenance">
          <SettingsCard>
            <SettingsAction
              label="Read again"
              actionLabel="Reload"
              onPress={() => void query.refetch()}
            />
          </SettingsCard>
        </SettingsSection>
      </ScrollView>
    );
  }

  const roleFor = (target: EditingTarget): OmoRole | null =>
    target.kind === "model_profile"
      ? null
      : (state.sections
          .find((section) => section.id === target.section)
          ?.roles.find((role) => role.kind === target.kind && role.name === target.name) ?? null);

  const profileFor = (target: EditingTarget): string | null =>
    state.sections.find((section) => section.id === target.section)?.modelProfile ?? null;

  // ---------------------------------------------------------------- editor

  if (editing) {
    const role = roleFor(editing);
    const currentModel =
      editing.kind === "model_profile"
        ? profileFor(editing)
        : (role?.model ?? role?.fallbackModels[0] ?? null);

    const needle = modelQuery.trim().toLowerCase();
    const matches = needle
      ? state.models.filter(
          (option) =>
            option.selector.toLowerCase().includes(needle) ||
            option.label.toLowerCase().includes(needle),
        )
      : state.models;
    const shown = matches.slice(0, MATCH_LIMIT);

    const reasoningOptions = state.reasoningLevels.map((level) => ({
      label: level,
      value: level,
    }));

    const title = editing.kind === "model_profile" ? "model_profile" : editing.name;

    return (
      <ScrollView style={styles.scroll} contentContainerStyle={styles.screen}>
        <View style={{ gap: 4 }}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.path}>
            {editing.sectionLabel} · {editing.kind}
          </Text>
        </View>

        <SettingsSection title="Current">
          <SettingsCard>
            <SettingsRow label="Model" hint={currentModel ?? "unset"} />
            {editing.kind !== "model_profile" ? (
              <SettingsRow label="Reasoning" hint={role?.reasoning ?? "unset"} />
            ) : null}
          </SettingsCard>
        </SettingsSection>

        <SettingsSection title="Model">
          <SettingsCard>
            <SettingsInput
              label="Filter"
              placeholder="Type to filter models"
              onChangeText={setModelQuery}
            />
            {shown.map((option) => {
              const isCurrent = option.selector === currentModel;
              return (
                <SettingsAction
                  key={option.selector}
                  label={option.selector}
                  hint={option.enabled ? "enabled" : option.label !== option.selector ? option.label : undefined}
                  actionLabel={isCurrent ? "Current" : "Use"}
                  disabled={apply.isPending || isCurrent}
                  onPress={() =>
                    apply.mutate({
                      section: editing.section,
                      kind: editing.kind,
                      name: editing.name,
                      model: option.selector,
                      reasoning: null,
                    })
                  }
                />
              );
            })}
            {matches.length > shown.length ? (
              <SettingsRow label={`${matches.length - shown.length} more — keep typing`} />
            ) : null}
            {matches.length === 0 ? (
              <SettingsRow label={`No model matches "${modelQuery}"`} />
            ) : null}
          </SettingsCard>
        </SettingsSection>

        {editing.kind !== "model_profile" ? (
          <SettingsSection title="Reasoning">
            <SettingsCard>
              <SettingsSelect
                label="Reasoning"
                hint={role?.reasoning ?? "unset"}
                value={role?.reasoning ?? state.reasoningLevels[0] ?? ""}
                options={reasoningOptions}
                disabled={apply.isPending}
                onValueChange={(reasoning) =>
                  apply.mutate({
                    section: editing.section,
                    kind: editing.kind,
                    name: editing.name,
                    model: null,
                    reasoning,
                  })
                }
              />
            </SettingsCard>
          </SettingsSection>
        ) : null}

        <SettingsSection title="Done">
          <SettingsCard>
            <SettingsAction
              label="Back to roles"
              actionLabel="Back"
              onPress={() => setEditing(null)}
            />
          </SettingsCard>
        </SettingsSection>
      </ScrollView>
    );
  }

  // ------------------------------------------------------------------ list

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.screen}>
      <View style={{ gap: 4 }}>
        <Text style={styles.title}>omo.jsonc models</Text>
        <Text style={styles.path}>
          {state.path}
          {state.exists ? "" : " (missing)"}
        </Text>
      </View>

      {state.parseError ? <Text style={styles.error}>Cannot edit: {state.parseError}</Text> : null}

      {state.sections.map((section: OmoSection) => {
        const showProfile = section.modelProfile !== null || section.id === "";
        const sectionLabel = section.id === "" ? "root" : section.label;
        return (
          <Fragment key={section.id || "root"}>
            <SettingsSection
              title={section.id === "" ? "Default (root)" : section.label}
              info={section.id === "" ? undefined : section.id}
            >
              <SettingsCard>
                {showProfile ? (
                  <SettingsAction
                    label="model_profile"
                    hint={section.modelProfile ?? "not set"}
                    actionLabel="Edit"
                    disabled={apply.isPending}
                    onPress={() =>
                      openEditor({
                        section: section.id,
                        sectionLabel,
                        kind: "model_profile",
                        name: "",
                      })
                    }
                  />
                ) : null}

                {section.roles.length === 0 ? (
                  <SettingsRow label="No roles in this section" />
                ) : (
                  section.roles.map((role) => (
                    <SettingsAction
                      key={`${role.kind}:${role.name}`}
                      label={role.name}
                      hint={`${role.kind} · ${role.model ?? "no model"} · ${role.reasoning ?? "no reasoning"}`}
                      actionLabel="Edit"
                      disabled={apply.isPending}
                      onPress={() =>
                        openEditor({
                          section: section.id,
                          sectionLabel,
                          kind: role.kind,
                          name: role.name,
                        })
                      }
                    />
                  ))
                )}
              </SettingsCard>
            </SettingsSection>
          </Fragment>
        );
      })}

      {state.warnings.length > 0 ? (
        <SettingsSection title="Warnings">
          <SettingsCard>
            {state.warnings.map((warning) => (
              <SettingsRow key={warning} label={warning} />
            ))}
          </SettingsCard>
        </SettingsSection>
      ) : null}

      <SettingsSection title="Maintenance">
        <SettingsCard>
          <SettingsAction
            label="Undo the last write"
            actionLabel="Undo"
            disabled={!state.canUndo || undo.isPending}
            onPress={() => undo.mutate()}
          />
          <SettingsAction
            label="Re-read omo.jsonc from disk"
            actionLabel="Reload"
            disabled={query.isFetching}
            onPress={() => void query.refetch()}
          />
        </SettingsCard>
      </SettingsSection>
    </ScrollView>
  );
}