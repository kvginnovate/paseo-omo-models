import type { PluginClientContext } from "@getpaseo/plugin/client";
import { OmoModelsScreen } from "./client/omo-models";

const ICON = "SlidersHorizontal";
const SURFACE_ID = "omo-models";
const SETTINGS_ID = "omo-models-settings";

export default function contribute(client: PluginClientContext) {
  client.addSurface(SURFACE_ID, OmoModelsScreen);
  client.addSidebarItem({
    id: SURFACE_ID,
    title: "omo models",
    icon: ICON,
    surface: SURFACE_ID,
  });
  client.addSettingsScreen({
    id: SETTINGS_ID,
    title: "omo.jsonc models",
    icon: ICON,
    Component: OmoModelsScreen,
  });
  client.addCommandCenterItem({
    id: "open-models",
    title: "Edit omo.jsonc models",
    icon: ICON,
    keywords: ["omo", "models", "reasoning", "model_profile"],
    context: "global",
    onSelect({ openSettings }) {
      openSettings(SETTINGS_ID);
    },
  });
  return () => {};
}