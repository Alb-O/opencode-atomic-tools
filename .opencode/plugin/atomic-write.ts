import { tool } from "@opencode-ai/plugin";
import path from "path";
import { getAgentIdentity } from "../utils/identity-helper.ts";
import { ensureBranchExists, worktreeAdd, commitFile } from "../utils/git-helpers.ts";
import { setSessionWorktree } from "../utils/worktree-session.ts";
import { mkdir } from "fs/promises";
import { setNote } from "../utils/edit-notes.ts";

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
          "One-line desc of what edit you're making and why; used for commit message (keep it technical)",
        ),
    },
    async execute(args, context) {
      const file = args.filePath;
      const body = args.content;

      const relSource = path.relative(process.cwd(), file) || file;
      const rel = relSource.startsWith("..") ? path.basename(file) : relSource;
      const desc = args.description || `Create ${rel}`;

      const identity = await getAgentIdentity({ sessionID: context.sessionID, agent: context.agent });
      const { branchName, userName, userEmail, middleName, hash } = identity as any;

      // Worktree path per session
      const worktreeName = `${middleName}-${hash}`;
      const worktreePath = path.join(".agent", "worktrees", worktreeName);

      // Ensure branch exists and add worktree (no-op if already present)
      await ensureBranchExists(branchName);
      try {
        await worktreeAdd(worktreePath, branchName);
      } catch (e) {
        // ignore if already exists
      }

      // Record session -> worktree mapping so future shell tools run inside it
      try {
        setSessionWorktree(context.sessionID, worktreePath);
      } catch (e) {
        // ignore
      }

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
