import writeAndCommitPlugin from "./atomic-write.ts";
import editAndCommitPlugin from "./atomic-edit.ts";
import { takeNote } from "../utils/edit-notes.ts";
import { getAgentIdentity } from "../utils/identity-helper.ts";
import path from "path";
import { stat } from "fs/promises";
import type { PluginInput } from "@opencode-ai/plugin";

export default async function atomicToolsPlugin(input: PluginInput) {
  const writePlugin = await writeAndCommitPlugin();
  const editPlugin = await editAndCommitPlugin(input);

  return {
    tool: {
      ...writePlugin.tool,
      ...editPlugin.tool,
    },
    "tool.execute.before": async (
      details: { tool: string; sessionID: string; callID: string },
      input: any,
    ) => {
      try {
        const args = (input && input.args) ? input.args as Record<string, unknown> : {};
        const identity = await getAgentIdentity({ sessionID: details.sessionID, agent: "" });
        const worktreeName = `${(identity as any).middleName}-${(identity as any).hash}`;
        const worktreePath = path.join(".agent", "worktrees", worktreeName);
        try {
          await stat(worktreePath);
          args.cwd = worktreePath;
          if (input) input.args = args;
        } catch (e) {
          // worktree doesn't exist, leave cwd untouched
        }
      } catch (e) {
        // ignore errors here - don't block tool execution
      }
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
