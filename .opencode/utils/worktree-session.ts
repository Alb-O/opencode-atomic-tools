const worktreeMap = new Map<string, string>();
const lazyAgentSessions = new Set<string>();
const worktreeOptedInSessions = new Set<string>();

export function setSessionWorktree(sessionID: string, worktreePath: string) {
  worktreeMap.set(sessionID, worktreePath);
}

export function getSessionWorktree(sessionID: string): string | undefined {
  return worktreeMap.get(sessionID);
}

export function clearSessionWorktree(sessionID: string) {
  worktreeMap.delete(sessionID);
}

export function markLazyAgentSession(sessionID: string) {
  lazyAgentSessions.add(sessionID);
}

export function isLazyAgentSession(sessionID: string): boolean {
  return lazyAgentSessions.has(sessionID);
}

export function optInToWorktree(sessionID: string) {
  worktreeOptedInSessions.add(sessionID);
}

export function hasOptedInToWorktree(sessionID: string): boolean {
  return worktreeOptedInSessions.has(sessionID);
}

export function optOutOfWorktree(sessionID: string) {
  worktreeOptedInSessions.delete(sessionID);
  clearSessionWorktree(sessionID);
}

export default { setSessionWorktree, getSessionWorktree, clearSessionWorktree, markLazyAgentSession, isLazyAgentSession, optInToWorktree, hasOptedInToWorktree, optOutOfWorktree };
