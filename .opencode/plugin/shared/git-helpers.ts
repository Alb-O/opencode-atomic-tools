import { createHash } from "crypto";
import { exec } from "child_process";
import { promisify } from "util";
import { writeFile } from "fs/promises";
import { faker } from "@faker-js/faker";

const execAsync = promisify(exec);

export interface GitContext {
  sessionID: string;
  agent: string;
}

export async function createAgentBranch(
  context: GitContext,
): Promise<{ branchName: string; userName: string; userEmail: string }> {
  const hash = createHash("sha256")
    .update(`${context.sessionID}`)
    .digest("hex")
    .substring(0, 8);

  const seed = parseInt(hash, 16);
  faker.seed(seed);
  const middleName = faker.person.middleName().toLowerCase();
  const userName = middleName.charAt(0).toUpperCase() + middleName.slice(1);
  const userEmail = `${middleName}@opencode.ai`;

  const branchName = `opencode/${middleName}-${hash}`;

  // Check current branch and create/switch to middleName-sessionID branch
  const { stdout: currentBranch } = await execAsync(
    "git branch --show-current",
  );
  if (currentBranch.trim() !== branchName) {
    try {
      await execAsync(`git checkout -b ${branchName}`);
    } catch (error) {
      await execAsync(`git checkout ${branchName}`);
    }
  }
  return { branchName, userName, userEmail };
}

export async function commitFile(
  filePath: string,
  description: string,
  userName?: string,
  userEmail?: string,
): Promise<string> {
  // Stage the touched file only
  await execAsync(`git add "${filePath}"`);

  // Get the diff of staged changes before committing
  const { stdout: diff } = await execAsync(`git diff --cached "${filePath}"`);

  // If a temporary user name/email were provided use git -c to apply them
  // only to this commit command so we don't persist changes to git config.
  const userArgs = userName && userEmail
    ? `-c user.name="${userName}" -c user.email="${userEmail}" `
    : "";

  await execAsync(`git ${userArgs}commit -m "${description}"`);

  return diff;
}

export async function atomicWriteAndCommit(
  filePath: string,
  content: string,
  description: string,
  context: GitContext,
): Promise<string> {
  const { branchName, userName, userEmail } = await createAgentBranch(context);

  await writeFile(filePath, content, "utf8");
  await commitFile(filePath, description, userName, userEmail);
  return `File written and committed: ${filePath} on branch ${branchName}`;
}

export { writeFile } from "fs/promises";
