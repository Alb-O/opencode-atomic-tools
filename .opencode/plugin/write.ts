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

export default async function writeWrapperPlugin() {
  const write_wrapper = tool({
    description: "Create a file and commit",
    args: {
      filePath: tool.schema
        .string()
        .describe("The absolute path to the file to write"),
      content: tool.schema
        .string()
        .describe("The content to write to the file"),
      description: tool.schema
        .string()
        .describe(
          "One-line desc of what edit you're making and why; used for commit message. REQUIRED: be highly technical, reference API, functions, signatures.",
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
      // description is required and must be a non-empty technical one-line summary
      const desc = (() => {
        if (!args.description || String(args.description).trim() === "") {
          throw new Error(
            "The 'description' argument is required and must be a non-empty, technical one-line summary for the commit. Please provide a technical description that references APIs, functions, or signatures.",
          );
        }
        return args.description;
      })();

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
      write: write_wrapper,
    },
  };
}
