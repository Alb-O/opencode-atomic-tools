import { createHash } from "crypto";
import { exec } from "child_process";
import { promisify } from "util";
import { writeFile } from "fs/promises";

const execAsync = promisify(exec);

export interface GitContext {
  sessionID: string;
  agent: string;
}

export async function createDeterministicBranch(
  context: GitContext,
): Promise<string> {
  const hash = createHash("sha256")
    .update(`${context.agent}-${context.sessionID}`)
    .digest("hex")
    .substring(0, 8);

  const branchName = `opencode/${context.agent}-${hash}`;

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

  return branchName;
}

export async function commitFile(
  filePath: string,
  description: string,
): Promise<void> {
  // Stage the specific file
  await execAsync(`git add "${filePath}"`);

  // Commit with the provided description
  await execAsync(`git commit -m "${description}"`);
}

export async function atomicWriteAndCommit(
  filePath: string,
  content: string,
  description: string,
  context: GitContext,
): Promise<string> {
  const branchName = await createDeterministicBranch(context);

  // Write the file
  await writeFile(filePath, content, "utf8");

  // Stage and commit
  await commitFile(filePath, description);

  return `File written and committed: ${filePath} on branch ${branchName}`;
}

// Re-export writeFile for convenience
export { writeFile } from "fs/promises";
