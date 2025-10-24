import { createHash } from "crypto";
import { faker } from "@faker-js/faker";

export interface GitContext {
  sessionID: string;
  agent: string;
}

export interface AgentIdentity {
  branchName: string;
  userName: string;
  userEmail: string;
  middleName: string;
  hash: string;
}

export async function getAgentIdentity(context: GitContext): Promise<AgentIdentity> {
  // Check if already in an agent tmux session
  const { getCurrentTmuxSession } = await import("./session-helpers");
  const currentSession = await getCurrentTmuxSession();
  
  if (currentSession) {
    // Check if current session matches agent pattern: [middleName]-[8-char-hash]
    const agentSessionPattern = /^([a-z]+)-([a-f0-9]{8})$/;
    const match = currentSession.name.match(agentSessionPattern);
    
    if (match) {
      const [, middleName, hash] = match;
      const userName = middleName.charAt(0).toUpperCase() + middleName.slice(1);
      const userEmail = `${middleName}@opencode.ai`;
      const branchName = `opencode/${middleName}-${hash}`;
      
      return { branchName, userName, userEmail, middleName, hash };
    }
  }

  // Create new identity if not in agent session
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

  return { branchName, userName, userEmail, middleName, hash };
}