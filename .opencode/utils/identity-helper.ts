import { createHash } from "crypto";
import { faker } from "@faker-js/faker";

export interface GitContext {
  sessionID: string;
  // agent may be undefined for legacy callers
  agent?: string;
}

export interface AgentIdentity {
  branchName: string;
  userName: string;
  userEmail: string;
  middleName: string;
  hash: string;
}

export async function getAgentIdentity(context: GitContext): Promise<AgentIdentity> {
  if (context.agent) {
    const { describeRemote } = await import("./opencode-remote");
    const remote = describeRemote(context.agent);
    if (remote && typeof remote.name === "string") {
      // Expect agent name format: <middleName>-<8-char-hash>
      const agentSessionPattern = /^([a-z]+)-([a-f0-9]{8})$/;
      const match = remote.name.match(agentSessionPattern);
      if (match) {
        const [, middleName, hash] = match;
        const userName = middleName.charAt(0).toUpperCase() + middleName.slice(1);
        const userEmail = `${middleName}@opencode.ai`;
        const branchName = `opencode/${middleName}-${hash}`;
        return { branchName, userName, userEmail, middleName, hash };
      }
    }
  }

  // Fallback: generate deterministic identity from sessionID
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