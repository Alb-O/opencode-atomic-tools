import writeAndCommitPlugin from "./atomic-write.ts";
import editAndCommitPlugin from "./atomic-edit.ts";
import { takeNote } from "../utils/edit-notes.ts";
import type { PluginInput } from "@opencode-ai/plugin";

export default async function atomicToolsPlugin(input: PluginInput) {
  const writePlugin = await writeAndCommitPlugin();
  const editPlugin = await editAndCommitPlugin(input);

  return {
    tool: {
      ...writePlugin.tool,
      ...editPlugin.tool,
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
