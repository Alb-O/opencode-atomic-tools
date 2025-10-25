import { tool } from "@opencode-ai/plugin";
import path from "path";
import { commitFile } from "../utils/git-helpers.ts";
import { mkdir } from "fs/promises";
import { setNote } from "../utils/edit-notes.ts";
import { resolveWorktreeContext } from "../utils/worktree.ts";

type MetaInput = {
  title?: string;
  metadata?: {
    filePath: string;
    diff: string;
  };
};

export default async function writeAndCommitPlugin() {
  const atomic_write = tool({
    description: "Write a file and atomic commit",
    args: {
      filePath: tool.schema
        .string()
        .describe("The absolute path to the file to write"),
      content: tool.schema
        .string()
        .describe("The content to write to the file"),
      description: tool.schema
        .string()
        .optional()
        .describe(
          "One-line desc of what edit you're making and why; used for commit message (keep it technical, reference API, functions, signatures, etc.)",
        ),
    },
    async execute(args, context) {
      const file = args.filePath;
      const body = args.content;

      const info = await resolveWorktreeContext({
        sessionID: context.sessionID,
        agent: context.agent,
        filePath: file,
      });
      const rel = info.relativePath;
      const worktreePath = info.worktreePath;
      const branchName = info.branchName;
      const userName = info.userName;
      const userEmail = info.userEmail;
      const desc = args.description || `Create ${rel}`;

      const fullPath = path.join(worktreePath, rel);
      await mkdir(path.dirname(fullPath), { recursive: true });
      await Bun.write(fullPath, body);

      const diff = await commitFile(rel, desc, userName, userEmail, worktreePath);

      const title = rel;
      const output = `File written and committed: ${rel} on branch ${branchName}`;
      const meta = { filePath: rel, diff };

      const hook = (context as unknown as { metadata?: (input: MetaInput) => void | Promise<void> }).metadata;
      if (typeof hook === "function") {
        const done = hook({ title, metadata: meta });
        if (done && typeof (done as { then?: unknown }).then === "function") {
          await done;
        }
      }

      const call = (context as unknown as { callID?: string }).callID;
      if (call) {
        setNote(call, { title, output, metadata: meta });
      }

      return output;
    },
  });

  return {
    tool: {
      write: atomic_write,
    },
  };
}
