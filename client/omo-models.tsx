import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import {
  SettingsAction,
  SettingsCard,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
} from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useMemo } from "react";
import { Text, View } from "react-native";
import {
  omoApplyRpc,
  omoStateRpc,
  omoUndoRpc,
  type OmoApplyInput,
  type OmoRole,
  type OmoState,
} from "../shared/omo";

const STATE_KEY = ["omo-models", "state"] as const;

export function OmoModelsScreen({ theme, layout }: PluginSurfaceProps) {
  const readState = useRpc(omoStateRpc);
  const applyEdit = useRpc(omoApplyRpc);
  const undoEdit = useRpc(omoUndoRpc);
  const queryClient = useQueryClient();
  const toast = useToast();

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

  // The settings frame owns scrolling, so this container must not claim flex.
  const styles = useMemo(
    () => ({
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

  if (query.isPending) {
    return (
      <View style={styles.screen}>
        <Text style={styles.path}>Reading omo.jsonc…</Text>
      </View>
    );
  }

  if (query.isError || !state) {
    return (
      <View style={styles.screen}>
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
      </View>
    );
  }

  const modelOptions = state.models.map((option) => ({
    label: option.enabled ? `${option.selector} · enabled` : option.selector,
    value: option.selector,
  }));
  const reasoningOptions = state.reasoningLevels.map((level) => ({ label: level, value: level }));

  const saveRole = (section: string, role: OmoRole) => (change: { model?: string; reasoning?: string }) =>
    apply.mutate({
      section,
      kind: role.kind,
      name: role.name,
      model: change.model ?? null,
      reasoning: change.reasoning ?? null,
    });

  return (
    <View style={styles.screen}>
      <View style={{ gap: 4 }}>
        <Text style={styles.title}>omo.jsonc models</Text>
        <Text style={styles.path}>
          {state.path}
          {state.exists ? "" : " (missing)"}
        </Text>
      </View>

      {state.parseError ? <Text style={styles.error}>Cannot edit: {state.parseError}</Text> : null}

      {state.sections.map((section) => {
        const showProfile = section.modelProfile !== null || section.id === "";
        const profileValue = section.modelProfile ?? "";
        const sectionName = section.id === "" ? "root" : section.label;
        return (
          <Fragment key={section.id || "root"}>
            <SettingsSection
              title={section.id === "" ? "Default (root)" : section.label}
              info={section.id === "" ? undefined : section.id}
            >
            <SettingsCard>
              {showProfile ? (
                <SettingsSelect
                  label="model_profile"
                  hint={profileValue === "" ? "not set" : undefined}
                  value={profileValue}
                  options={
                    profileValue === "" ? [{ label: "(unset)", value: "" }, ...modelOptions] : modelOptions
                  }
                  disabled={apply.isPending}
                  onValueChange={(value) => {
                    if (value === "") return;
                    apply.mutate({
                      section: section.id,
                      kind: "model_profile",
                      name: "",
                      model: value,
                      reasoning: null,
                    });
                  }}
                />
              ) : null}

              {section.roles.length === 0 ? (
                <SettingsRow label="No roles in this section" />
              ) : (
                section.roles.map((role) => (
                  <SettingsSelect
                    key={`${role.kind}:${role.name}:model`}
                    label={role.name}
                    hint={role.kind}
                    value={role.model ?? role.fallbackModels[0] ?? ""}
                    options={
                      role.model || role.fallbackModels.length > 0
                        ? modelOptions
                        : [{ label: "(unset)", value: "" }, ...modelOptions]
                    }
                    disabled={apply.isPending}
                    onValueChange={(model) => {
                      if (model === "") return;
                      saveRole(section.id, role)({ model });
                    }}
                  />
                ))
              )}
            </SettingsCard>

            {section.roles.length > 0 ? (
              <SettingsSection title={`${sectionName} reasoning`}>
                <SettingsCard>
                  {section.roles.map((role) => (
                    <SettingsSelect
                      key={`${role.kind}:${role.name}:reasoning`}
                      label={role.name}
                      hint={role.reasoning ?? "unset"}
                      value={role.reasoning ?? ""}
                      options={[{ label: "(unset)", value: "" }, ...reasoningOptions]}
                      disabled={apply.isPending}
                      onValueChange={(reasoning) => {
                        if (reasoning === "") return;
                        saveRole(section.id, role)({ reasoning });
                      }}
                    />
                  ))}
                </SettingsCard>
              </SettingsSection>
            ) : null}
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
    </View>
  );
}