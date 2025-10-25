import LazyWritePlugin from "./lazy-write.ts";
import LazyEditPlugin from "./lazy-edit.ts";
import { takeNote } from "../utils/edit-notes.ts";
import { wrapToolCallWithWorktree } from "../utils/worktree.ts";
import type { PluginInput } from "@opencode-ai/plugin";

export default async function lazyToolsPlugin(input: PluginInput) {
  const writePlugin = await LazyWritePlugin();
  const editPlugin = await LazyEditPlugin(input);

  return {
    tool: {
      ...writePlugin.tool,
      ...editPlugin.tool,
    },
    "tool.execute.before": async (
      details: { tool: string; sessionID: string; callID: string },
      state: { args: any },
    ) => {
      if (!state || !state.args || typeof state.args !== "object") {
        return;
      }
      wrapToolCallWithWorktree({
        sessionID: details.sessionID,
        tool: details.tool,
        args: state.args,
        rootDirectory: input.directory,
      });
    },
    "tool.execute.after": async (
      details: { tool: string; sessionID: string; callID: string },
      result: { title: string; output: string; metadata: any }
    ) => {
      const note = takeNote(details.callID);
      if (note) {
        result.title = note.title;
        result.output = note.output;
        result.metadata = note.metadata;
      }
    },
  };
}
