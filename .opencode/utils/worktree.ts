import path from "path";
import { ensureBranchExists, worktreeAdd } from "./git-helpers.ts";
import { setSessionWorktree } from "./worktree-session.ts";
import { getAgentIdentity } from "./identity-helper.ts";

export interface WorktreeContextInput {
  sessionID: string;
  agent: string;
  filePath: string;
}

export interface WorktreeContext {
  worktreePath: string;
  relativePath: string;
  branchName: string;
  userName: string;
  userEmail: string;
}

function normalizeTarget(root: string, file: string) {
  const rel = path.relative(root, file);
  if (!rel.startsWith("..")) {
    return rel || path.basename(file);
  }
  const base = path.relative(process.cwd(), file) || file;
  if (!base.startsWith("..")) {
    return base;
  }
  return path.basename(file);
}

export async function resolveWorktreeContext(input: WorktreeContextInput): Promise<WorktreeContext> {
  const identity = await getAgentIdentity({ sessionID: input.sessionID, agent: input.agent });
  const name = `${identity.middleName}-${identity.hash}`;
  const worktreePath = path.join(".agent", "worktrees", name);
  await ensureBranchExists(identity.branchName);
  await worktreeAdd(worktreePath, identity.branchName).catch(() => undefined);
  setSessionWorktree(input.sessionID, worktreePath);
  const abs = path.isAbsolute(input.filePath) ? input.filePath : path.resolve(process.cwd(), input.filePath);
  const root = path.isAbsolute(worktreePath) ? worktreePath : path.resolve(process.cwd(), worktreePath);
  const rel = normalizeTarget(root, abs);
  return {
    worktreePath,
    relativePath: rel,
    branchName: identity.branchName,
    userName: identity.userName,
    userEmail: identity.userEmail,
  };
}
