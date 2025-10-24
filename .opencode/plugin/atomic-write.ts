import { tool } from "@opencode-ai/plugin";
import { writeFile } from "fs/promises";
import { createDeterministicBranch, commitFile } from "./shared/git-helpers.js";

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
      const { filePath, content, description } = args;
      const { sessionID, agent } = context;

      try {
        // Create deterministic branch and switch to it
        const branchName = await createDeterministicBranch({
          sessionID,
          agent,
        });

        // Write the file (replicating write tool behavior)
        await writeFile(filePath, content, "utf8");

        // Stage and commit the change and get diff
        const diff = await commitFile(filePath, description);

        return {
          metadata: {
            filePath,
            diff
          },
          title: `File written and committed: ${filePath} on branch ${branchName}`,
          output: `File written and committed: ${filePath} on branch ${branchName}`
        };
      } catch (error) {
        throw new Error(`Failed to write and commit file: ${error.message}`);
      }
    },
  });

  return {
    tool: {
      atomic_write,
    },
  };
}
