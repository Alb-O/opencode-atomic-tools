import { tool } from "@opencode-ai/plugin";
import path from "path";
import { createDeterministicBranch, commitFile } from "./shared/git-helpers.js";
import { setNote } from "./shared/edit-notes.js";

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
        .describe(
          "One-line desc of what edit you're making and why; used for commit message (keep it technical)",
        ),
    },
    async execute(args, context) {
      const file = args.filePath;
      const body = args.content;
      const desc = args.description;

      const branch = await createDeterministicBranch({
        sessionID: context.sessionID,
        agent: context.agent,
      });

      await Bun.write(file, body);
      const diff = await commitFile(file, desc);

      const relSource = path.relative(process.cwd(), file) || file;
      const rel = relSource.startsWith("..") ? path.basename(file) : relSource;

      const title = rel;
      const output = `File written and committed: ${rel} on branch ${branch}`;
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
