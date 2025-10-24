import { type Plugin, tool } from "@opencode-ai/plugin";
import path from "path";
import { createTwoFilesPatch } from "diff";
import { createAgentBranch, commitFile } from "./shared/git-helpers.ts";
import { setNote } from "./shared/edit-notes.ts";

type MetaInput = {
  title?: string;
  metadata?: {
    filePath: string;
    diff: string;
  };
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
        .optional()
        .describe(
          "One-line desc of what edit you're making and why; used for commit message (keep it technical)",
        ),
    },
    async execute(args, context) {
      const file = args.filePath;
      const old = args.oldString;
      const value = args.newString;
      const all = args.replaceAll ?? false;
      const relSource = path.relative(process.cwd(), file) || file;
      const rel = (() => {
        if (relSource.startsWith("..")) {
          return path.basename(file);
        }
        return relSource;
      })();
      const desc = args.description || `Update ${rel}`;

      const { branchName, userName, userEmail } = await createAgentBranch({
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

  await Bun.write(file, body);
      const raw = createTwoFilesPatch(file, file, curr, body);
      const diff = (() => {
        const lines = raw.split("\n");
        const content = lines.filter(
          (line) =>
            (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ")) &&
            !line.startsWith("---") &&
            !line.startsWith("+++"),
        );
        if (content.length === 0) return raw;
        const indent = content.reduce((size, line) => {
          const text = line.slice(1);
          if (text.trim().length === 0) return size;
          const match = text.match(/^(\s*)/);
          if (!match) return size;
          if (match[1].length < size) return match[1].length;
          return size;
        }, Number.POSITIVE_INFINITY);
        if (!Number.isFinite(indent) || indent === 0) return raw;
        return lines
          .map((line) => {
            if (
              (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ")) &&
              !line.startsWith("---") &&
              !line.startsWith("+++")
            ) {
              const prefix = line[0];
              const text = line.slice(1);
              return `${prefix}${text.slice(indent)}`;
            }
            return line;
          })
          .join("\n");
      })();
  await commitFile(file, desc, userName, userEmail);

  const title = rel;
  const output = `File edited and committed: ${rel} on branch ${branchName}`;
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
      edit: atomic_edit,
    },
  };
};

export default AtomicEdit;
