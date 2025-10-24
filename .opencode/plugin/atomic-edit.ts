import { tool } from "@opencode-ai/plugin";
import { readFile, writeFile } from "fs/promises";
import { createDeterministicBranch, commitFile } from "./shared/git-helpers.js";

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
        let newContent;
        if (replaceAll) {
          // Replace all occurrences
          newContent = currentContent.split(oldString).join(newString);

          // Check if any replacements were made
          if (newContent === currentContent) {
            throw new Error(`oldString not found in content: ${oldString}`);
          }
        } else {
          // Replace first occurrence only
          const index = currentContent.indexOf(oldString);
          if (index === -1) {
            throw new Error(`oldString not found in content: ${oldString}`);
          }

          // Check for multiple occurrences when replaceAll is false
          const firstIndex = currentContent.indexOf(oldString);
          const secondIndex = currentContent.indexOf(oldString, firstIndex + 1);
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

        // Write the modified content back to the file
        await writeFile(filePath, newContent, "utf8");

        // Stage and commit the change
        await commitFile(filePath, description);

        return `File edited and committed: ${filePath} on branch ${branchName}`;
      } catch (error) {
        throw new Error(`Failed to edit and commit file: ${error.message}`);
      }
    },
  });

  return {
    tool: {
      atomic_edit,
    },
  };
}
