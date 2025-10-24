import { tool } from "@opencode-ai/plugin";
import { readFile, writeFile } from "fs/promises";
import { createDeterministicBranch, commitFile } from "./shared/git-helpers.js";
import { createTwoFilesPatch } from "diff";

export default async function editAndCommitPlugin() {
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
      const { filePath, oldString, newString, replaceAll, description } = args;
      const { sessionID, agent } = context;

      try {
        // Create deterministic branch and switch to it
        const branchName = await createDeterministicBranch({
          sessionID,
          agent,
        });

        // Read the current file content
        const currentContent = await readFile(filePath, "utf8");

        // Apply the edit
        let newContent: string;
        if (replaceAll) {
          newContent = currentContent.split(oldString).join(newString);
          if (newContent === currentContent) {
            throw new Error(`oldString not found in content: ${oldString}`);
          }
        } else {
          const index = currentContent.indexOf(oldString);
          if (index === -1) {
            throw new Error(`oldString not found in content: ${oldString}`);
          }
          const secondIndex = currentContent.indexOf(oldString, index + 1);
          if (secondIndex !== -1) {
            throw new Error(
              `oldString found multiple times and requires more code context to uniquely identify the intended match. Either provide a larger string with more surrounding context to make it unique or use replaceAll to change every instance of oldString.`,
            );
          }

          newContent =
            currentContent.substring(0, index) +
            newString +
            currentContent.substring(index + oldString.length);
        }

        // Create a unified diff patch from the old and new contents
        // (this is what the TUI's diff parser/renderer expects)
        const diffPatch = createTwoFilesPatch(filePath, filePath, currentContent, newContent);

        // Write the modified content back to the file
        await writeFile(filePath, newContent, "utf8");

        // Stage and commit the change (keep committing behavior)
        // commitFile may be untyped JS; cast to any to avoid TS issues
        const commitResult: any = await commitFile(filePath, description);
        // (we don't rely on commitResult for the diff because we already constructed diffPatch)

        // Build guaranteed-string outputs
        const out = `File edited and committed: ${filePath} on branch ${branchName}`;

        // Send metadata to host runtime so clients (TUI / web / desktop) can pick it up.
        // Some plugin type defs might not include context.metadata, so cast to any at call site.
        (context as any).metadata?.({
          title: out,
          metadata: {
            filePath,
            diff: diffPatch,
          },
        });

        // Return a plain string (matches execute return type expected by your environment)
        return out;
      } catch (error) {
        const msg = error && error instanceof Error ? `${error.message}\n${error.stack}` : String(error);
        throw new Error(`Failed to edit and commit file: ${msg}`);
      }
    },
  });

  return {
    tool: {
      atomic_edit,
    },
  };
}
