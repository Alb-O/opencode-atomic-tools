const map = new Map<string, string>();

export function setSessionWorktree(sessionID: string, worktreePath: string) {
  map.set(sessionID, worktreePath);
}

export function getSessionWorktree(sessionID: string): string | undefined {
  return map.get(sessionID);
}

export function clearSessionWorktree(sessionID: string) {
  map.delete(sessionID);
}

export default { setSessionWorktree, getSessionWorktree, clearSessionWorktree };
