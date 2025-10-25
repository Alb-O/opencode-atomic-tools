import { type Plugin, tool } from "@opencode-ai/plugin";
import path from "path";
import { createTwoFilesPatch } from "diff";
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

export const EditWrapper: Plugin = async () => {
  const edit_wrapper = tool({
    description:
      "Apply exact string replacement edits to a file and commit",
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
          "One-line desc of what edit you're making and why; used for commit message. IMPORTANT: be highly technical, reference API, functions, signatures.",
        ),
    },
    async execute(args, context) {
      const file = args.filePath;
      const old = args.oldString;
      const value = args.newString;
      const all = args.replaceAll ?? false;
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
      const desc = args.description || `Update ${rel}`;

      const fullPath = path.join(worktreePath, rel);
      await mkdir(path.dirname(fullPath), { recursive: true });

      const curr = await Bun.file(fullPath).text();
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

      await Bun.write(path.join(worktreePath, rel), body);
      const raw = createTwoFilesPatch(rel, rel, curr, body);
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
      await commitFile(rel, desc, userName, userEmail, worktreePath);

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
      edit: edit_wrapper,
    },
  };
};

export default EditWrapper;
