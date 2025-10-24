import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export interface TmuxSession {
  id: string;
  name: string;
  attached: boolean;
}

/**
 * Parse tmux session line into structured data
 * 
 * Input examples:
 * - "1: my-session (3 windows) (attached)"
 * - "2: dev-workspace (1 windows)"
 * - "3: agent-session-abc123 (5 windows) (attached)"
 * 
 * Output: { id: "1", name: "my-session", attached: true } or null if no match
 */
function parseTmuxSessionLine(line: string): TmuxSession | null {
  // Match pattern: [id]: [name] ([num] windows) (optional: (attached))
  // Examples:
  // "1: my-session (3 windows) (attached)" -> ["1", "my-session", "3", "(attached)"]
  // "2: dev-workspace (1 windows)" -> ["2", "dev-workspace", "1", undefined]
  const match = line.match(/^(\d+):\s+([^\s]+)\s+\((\d+)\s+windows\)(\s+\(attached\))?$/);
  
  if (!match) {
    return null;
  }

  return {
    id: match[1],
    name: match[2],
    attached: !!match[4] // match[4] is "(attached)" or undefined
  };
}

export async function getCurrentTmuxSession(): Promise<TmuxSession | null> {
  try {
    const { stdout } = await execAsync('echo $TMUX');
    if (!stdout.trim()) {
      return null;
    }

    const tmuxSocket = stdout.trim();
    const { stdout: sessions } = await execAsync(`tmux -S ${tmuxSocket} list-sessions`);
    
    // Find the line with "(attached)" suffix
    const currentSessionLine = sessions.split('\n').find(line => line.includes('(attached)'));
    if (!currentSessionLine) {
      return null;
    }

    return parseTmuxSessionLine(currentSessionLine);
  } catch (error) {
    return null;
  }
}

/**
 * Check if current tmux session name matches agent identity pattern
 * 
 * Agent session pattern: [middleName]-[8-char-hash]
 * Examples:
 * - "smith-a1b2c3d4" -> true
 * - "johnson-e5f6g7h8" -> true  
 * - "dev-workspace" -> false
 * - "my-session" -> false
 */
export async function isInAgentSession(): Promise<boolean> {
  const currentSession = await getCurrentTmuxSession();
  if (!currentSession) {
    return false;
  }

  // Agent session pattern: [middleName]-[8-char-hash]
  // middleName: lowercase letters only
  // hash: 8 hexadecimal characters
  const agentSessionPattern = /^[a-z]+-[a-f0-9]{8}$/;
  
  return agentSessionPattern.test(currentSession.name);
}

export async function listTmuxSessions(): Promise<TmuxSession[]> {
  try {
    // tmux list-sessions output example:
    // "1: my-session (3 windows) (attached)"
    // "2: dev-workspace (1 windows)"
    // "3: agent-session-abc123 (5 windows)"
    const { stdout } = await execAsync('tmux list-sessions 2>/dev/null || echo ""');
    if (!stdout.trim()) {
      return [];
    }

    return stdout.split('\n')
      .filter(line => line.trim())
      .map(parseTmuxSessionLine)
      .filter((session): session is TmuxSession => session !== null);
  } catch (error) {
    return [];
  }
}