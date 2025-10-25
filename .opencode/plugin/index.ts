import path from "path";
import LazyWritePlugin from "./lazy-write.ts";
import LazyEditPlugin from "./lazy-edit.ts";
import { takeNote } from "../utils/edit-notes.ts";
import { getSessionWorktree } from "../utils/worktree-session.ts";
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
      if (!state) {
        return;
      }
      const wt = getSessionWorktree(details.sessionID);
      if (!wt) {
        return;
      }
      const root = input.directory;
      const cwd = path.isAbsolute(wt) ? wt : path.join(root, wt);
      const args = state.args;
      if (!args || typeof args !== "object") {
        return;
      }
      (args as Record<string, unknown>).cwd = cwd;
      const name = details.tool.toLowerCase();
      if (name === "bash") {
        const command = (args as Record<string, unknown> & { command?: unknown }).command;
        if (typeof command === "string" && command.trim().length) {
          const quoted = JSON.stringify(cwd);
          const prefix = `cd ${quoted} && `;
          if (!command.startsWith(prefix)) {
            (args as Record<string, unknown> & { command?: unknown }).command = `${prefix}(${command})`;
          }
        }
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
