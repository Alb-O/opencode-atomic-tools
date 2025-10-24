import { tool } from "@opencode-ai/plugin";
import { createHash } from "crypto";
import { writeFile } from "fs/promises";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export default async function writeAndCommitPlugin() {
  const atomicWrite = tool({
    description:
      "Write a file and atomic commit",
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
        // Create deterministic branch name based on session/agent info
        const hash = createHash("sha256")
          .update(`${agent}-${sessionID}`)
          .digest("hex")
          .substring(0, 8);

        const branchName = `opencode/${agent}-${hash}`;

        // Check current branch and switch if needed
        const { stdout: currentBranch } = await execAsync(
          "git branch --show-current",
        );

        if (currentBranch.trim() !== branchName) {
          try {
            await execAsync(`git checkout -b ${branchName}`);
          } catch (error) {
            // Branch might already exist, just checkout
            await execAsync(`git checkout ${branchName}`);
          }
        }

        // Write the file (replicating write tool behavior)
        await writeFile(filePath, content, "utf8");

        // Stage the specific file
        await execAsync(`git add "${filePath}"`);

        // Commit with the provided description
        await execAsync(`git commit -m "${description}"`);

        return `File written and committed: ${filePath} on branch ${branchName}`;
      } catch (error) {
        throw new Error(`Failed to write and commit file: ${error.message}`);
      }
    },
  });

  return {
    tool: {
      atomicWrite,
    },
  };
}
