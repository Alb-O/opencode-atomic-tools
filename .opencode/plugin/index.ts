import WriteWrapperPlugin from "./write.ts";
import EditWrapperPlugin from "./edit.ts";
import { worktree_jump_in } from "../tool/wt_agent.ts";
import { takeNote } from "../utils/edit-notes.ts";
import { wrapToolCallWithWorktree } from "../utils/worktree.ts";
import { isWtAgentSession, hasOptedInToWorktree } from "../utils/worktree-session.ts";
import type { PluginInput } from "@opencode-ai/plugin";

export default async function wtAgentPlugin(input: PluginInput) {
  const writePlugin = await WriteWrapperPlugin();
  const editPlugin = await EditWrapperPlugin(input);

  return {
    tool: {
      ...writePlugin.tool,
      ...editPlugin.tool,
      worktree_opt_in: worktree_jump_in,
    },
    "tool.execute.before": async (
      details: { tool: string; sessionID: string; callID: string },
      state: { args: any },
    ) => {
      if (!state || !state.args || typeof state.args !== "object") {
        return;
      }
      // Enable worktree wrapping for wt_agent sessions OR sessions that have opted in
      if (isWtAgentSession(details.sessionID) || hasOptedInToWorktree(details.sessionID)) {
        wrapToolCallWithWorktree({
          sessionID: details.sessionID,
          tool: details.tool,
          args: state.args,
          rootDirectory: input.directory,
        });
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
