import { type Plugin, tool } from "@opencode-ai/plugin";
import path from "path";
import { createTwoFilesPatch } from "diff";
import { createDeterministicBranch, commitFile } from "./shared/git-helpers.js";

type MetaInput = {
  title?: string;
  metadata?: {
    filePath: string;
    diff: string;
  };
  output?: string;
};

export const AtomicEdit: Plugin = async () => {
  const atomic_edit = tool({
    description:
      "Apply exact string replacement edits to a file and atomic commit",
    args: {
      filePath: tool.schema
        .string()
        .describe("The absolute path to the file to edit"),
      oldString: tool.schema
        .string()
        .describe("The exact string to find and replace"),
      newString: tool.schema.string().describe("The replacement string"),
      replaceAll: tool.schema
        .boolean()
        .optional()
        .default(false)
        .describe("Replace all occurrences of oldString (default: false)"),
      description: tool.schema
        .string()
        .describe(
          "One-line desc of what edit you're making and why; used for commit message (keep it technical)",
        ),
    },
    async execute(args, context) {
      const file = args.filePath;
      const old = args.oldString;
      const value = args.newString;
      const all = args.replaceAll ?? false;
      const desc = args.description;

      const branch = await createDeterministicBranch({
        sessionID: context.sessionID,
        agent: context.agent,
      });

      const curr = await Bun.file(file).text();
      const body = (() => {
        if (all) {
          const replaced = curr.split(old).join(value);
          if (replaced === curr) {
            throw new Error(`oldString not found in content: ${old}`);
          }
          return replaced;
        }
        const index = curr.indexOf(old);
        if (index === -1) {
          throw new Error(`oldString not found in content: ${old}`);
        }
        const again = curr.indexOf(old, index + 1);
        if (again !== -1) {
          throw new Error(
            `oldString found multiple times and requires more code context to uniquely identify the intended match. Either provide a larger string with more surrounding context to make it unique or use replaceAll to change every instance of oldString.`,
          );
        }
        return `${curr.slice(0, index)}${value}${curr.slice(index + old.length)}`;
      })();

      const relSource = path.relative(process.cwd(), file) || file;
      const rel = (() => {
        if (relSource.startsWith("..")) {
          return path.basename(file);
        }
        return relSource;
      })();

      const diff = createTwoFilesPatch(
        `a/${rel}`,
        `b/${rel}`,
        curr,
        body,
      );

      await Bun.write(file, body);
      await commitFile(file, desc);

      const title = `File edited and committed: ${file}`;
      const output = `${title} on branch ${branch}`;
      const meta = { filePath: rel, diff };

      const hook = (context as unknown as { metadata?: (input: MetaInput) => void }).metadata;
      if (typeof hook === "function") {
        hook({ title, metadata: meta, output });
      }

      return JSON.stringify({ title, metadata: meta, output });
    },
  });

  return {
    tool: {
      atomic_edit,
    },
  };
};

export default AtomicEdit;
