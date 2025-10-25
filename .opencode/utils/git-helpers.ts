import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

/**
 * Run a git command and return stdout (throws on error)
 */
export async function runGit(args: string[], opts?: { cwd?: string }): Promise<string> {
  const cmd = `git ${args.map(a => a).join(" ")}`;
  const res = await execAsync(cmd, opts || {});
  return (res && (res as any).stdout) || "";
}

export async function worktreeAdd(worktreePath: string, branch: string): Promise<void> {
  await execAsync(`git worktree add "${worktreePath}" "${branch}"`);
}

export async function worktreeRemove(worktreePath: string): Promise<void> {
  await execAsync(`git worktree remove --force "${worktreePath}"`);
}

export async function listWorktrees(): Promise<Array<{ worktreePath: string; branch?: string }>> {
  const res = await execAsync(`git worktree list --porcelain 2>/dev/null || echo ""`);
  const stdout = (res as any).stdout || "";
  if (!stdout.trim()) return [];

  const entries = stdout.split('\n\n').map((s: string) => s.trim()).filter(Boolean);
  const results: Array<{ worktreePath: string; branch?: string }> = [];

  for (const entry of entries) {
    const lines = entry.split('\n');
    const wtLine = lines.find((l: string) => l.startsWith('worktree '));
    const branchLine = lines.find((l: string) => l.startsWith('branch '));
    if (!wtLine) continue;
    const p = wtLine.replace(/^worktree\s+/, '').trim();
    results.push({ worktreePath: p, branch: branchLine ? branchLine.replace(/^branch\s+/, '').trim() : undefined });
  }

  return results;
}

/**
 * Ensure a branch exists locally; do not check it out.
 */
export async function ensureBranchExists(branch: string): Promise<void> {
  const res = await execAsync(`git branch --list "${branch}"`);
  const stdout = (res as any).stdout || "";
  if (!stdout.trim()) {
    await execAsync(`git branch "${branch}"`);
  }
}

export async function commitFile(
  filePath: string,
  description: string,
  userName?: string,
  userEmail?: string,
  cwd?: string,
): Promise<string> {
  // Stage the touched file only
  await execAsync(`git add "${filePath}"`, cwd ? { cwd } : {} as any);

  // Get the diff of staged changes before committing
  const _d = await execAsync(`git diff --cached "${filePath}"`, cwd ? { cwd } : {} as any);
  const diff = (_d as any).stdout || "";

  // If a temporary user name/email were provided use git -c to apply them
  // only to this commit command so we don't persist changes to git config.
  const userArgs = userName && userEmail
    ? `-c user.name="${userName}" -c user.email="${userEmail}" `
    : "";

  // Opinionated commit message style: lowercase english (not code symbols/API)
  const firstWord = description.split(" ")[0];
  const styleCharIdx = "([<{\"\'".includes(firstWord[0]) ? 1 : 0;
  const styleChar = firstWord[styleCharIdx] || "";

  // Heuristic to detect code-like symbols. We treat as symbols:
  // - starts with _ or $
  // - ALL_CAPS or digits/underscores
  // - kebab-case or snake_case (lowercase-with-separators)
  // - camelCase (has an internal uppercase)
  // - PascalCase with multiple segments (e.g., FooBar)
  const symbolPattern = /^([_$][A-Za-z0-9_$]*|[A-Z0-9_]+|[a-z0-9]+(?:[-_][a-z0-9]+)+|[a-z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*|[A-Z][a-z0-9]+(?:[A-Z][A-Za-z0-9]+)+)$/;

  // Detect plain English capitalized words like "Implement" (single initial cap,
  // followed by all lowercase).
  const isPlainCapitalized = /^[A-Z][a-z]+$/.test(styleChar + firstWord.slice(styleCharIdx + 1));

  // If it's a code-like symbol leave it as-is, otherwise lowercase the styleChar.
  let finalDescription;
  if (symbolPattern.test(firstWord) && !isPlainCapitalized) {
    finalDescription = description;
  } else {
    // Lowercase the styleChar (first or second char), keep the rest as-is
    if (styleCharIdx === 0) {
      finalDescription = styleChar.toLowerCase() + description.slice(1);
    } else {
      finalDescription = description.slice(0, styleCharIdx) + styleChar.toLowerCase() + description.slice(styleCharIdx + 1);
    }
  }

  // Serialize the message so internal quotes are escaped for the shell.
  const msg = JSON.stringify(finalDescription);
  await execAsync(`git ${userArgs}commit -m ${msg}`, cwd ? { cwd } : {} as any);

  return diff;
}

export { writeFile } from "fs/promises";
