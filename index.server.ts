import type { PluginServerContext } from "@getpaseo/plugin/server";
import { applyEdit, readState, undo } from "./server/omo-config";
import { omoApplyRpc, omoStateRpc, omoUndoRpc } from "./shared/omo";

export default function contribute(server: PluginServerContext) {
  server.handle(omoStateRpc, () => readState());
  server.handle(omoApplyRpc, (input) => applyEdit(input));
  server.handle(omoUndoRpc, () => undo());
  return () => {};
}
