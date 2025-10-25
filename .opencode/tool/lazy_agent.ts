import { tool } from "@opencode-ai/plugin"
import { getAgentIdentity } from "../utils/identity-helper.ts"
import {
  ensureRemoteSession,
  describeRemote,
  shutdownRemote,
  runShell,
  captureOutput,
} from "../utils/opencode-remote.ts"
import { markLazyAgentSession, optInToWorktree, isLazyAgentSession, optOutOfWorktree } from "../utils/worktree-session.ts"

async function agentSession(context: { sessionID: string; agent: string }) {
  const identity = await getAgentIdentity(context)
  return `${identity.middleName}-${identity.hash}`
}

export const list_sessions = tool({
  description: "List sessions for this agent",
  args: {},
  async execute(_args, context) {
    // session name not needed for listing, but keep identity check to ensure context
    const sessionName = await agentSession(context)
    await getAgentIdentity(context)

    const info = describeRemote(sessionName)
    if (!info) return "No sessions"
    return info.active
      ? `Session ${sessionName} active at ${info.url}`
      : `Session ${sessionName} exists but not active`
  },
})

export const new_session = tool({
  description: "Start a new detached session agent and give it a task",
  args: {
    initial_prompt: tool.schema.string().describe("Initial prompt to give the session agent. Must be a detailed, describe the agent's goals and relevant context."),
  },
  async execute(args, context) {
    const { initial_prompt } = args
    if (!initial_prompt || String(initial_prompt).trim().length === 0) {
      throw new Error(
        "Initial prompt is required. Please include a detailed message describing the agent's goals and relevant context."
      )
    }
    const sessionName = await agentSession(context)
    // Mark this session as a lazy agent session to enable worktree wrapping
    markLazyAgentSession(sessionName)
    // Ensure an opencode remote session exists for this agent (starts server + session)
  await ensureRemoteSession(sessionName)

  const reply = await runShell(sessionName, initial_prompt)
  if (reply && reply !== "No messages") return reply
  return `Session ${sessionName} created`
  },
})

export const kill_session = tool({
  description: "Kill this agent's session",
  args: {},
  async execute(_args, context) {
    const sessionName = await agentSession(context)
    const ok = await shutdownRemote(sessionName)
    if (!ok) return `Session ${sessionName} not found`
    return `Session ${sessionName} killed`
  },
})

export const capture_pane = tool({
  description: "Capture recent lines from the agent's session output",
  args: {
    limit: tool.schema.number().optional().describe("No. of lines to capture (default 200)"),
  },
  async execute(args, context) {
    const limit = (typeof args.limit === 'number' && args.limit > 0) ? Math.floor(args.limit) : 200
    const sessionName = await agentSession(context)
    // Use the remote capture API to retrieve recent session messages.
    const resp = await captureOutput(sessionName, limit)
    if (!resp || resp === "No messages") return `Session ${sessionName} has no output`

    const lines = resp.split(/\r?\n/).map(l => l.trim())
    // Keep lines that have at least one printable ASCII character
    const filtered = lines.filter(l => l.length > 0 && /[ -~]/.test(l)).slice(-limit)
    const out = filtered.join("\n").trim()
    return out || "No useful output captured"
  },
})

export const send_prompt = tool({
  description: "Send a prompt message to an existing session agent",
  args: {
    prompt: tool.schema.string().describe("Prompt text to send to the existing agent session"),
  },
  async execute(args, context) {
    const { prompt } = args
    if (!prompt || String(prompt).trim().length === 0) {
      throw new Error(
        "Prompt is required. Please include a detailed message describing what you want the agent to do."
      )
    }

    const sessionName = await agentSession(context)
    const info = describeRemote(sessionName)
    if (!info || !info.active) return `Session ${sessionName} not running`

  const reply = await runShell(sessionName, prompt)
    if (reply && reply !== "No messages") return reply
    return `Session ${sessionName} responded without text`
  },
})

export const worktree_opt_in = tool({
  description: "Opt into worktree functionality for this session. This allows file operations to be isolated in a git worktree. Only available for non-lazy-agent sessions.",
  args: {
    session_id: tool.schema.string().describe("The session ID to opt into worktree functionality"),
  },
  async execute(args, context) {
    // Allow calling with no session_id or an empty string to opt OUT (switch back to non-worktree session)
  const raw = (args as any)?.session_id as unknown;
  const session_id = typeof raw === "string" ? raw.trim() : raw ? String(raw).trim() : "";

    // Opt-out path: no session id provided => switch the current session back to the non-worktree context
    if (!session_id) {
      const current = (context as any).sessionID as string | undefined;
      if (!current) {
        throw new Error("No session context available to opt out")
      }
      if (isLazyAgentSession(current)) {
        throw new Error("Cannot switch a lazy agent back to a non-worktree session; lazy agents always use worktrees.")
      }
      optOutOfWorktree(current);
      return `Session ${current} switched back to non-worktree session`;
    }

    // Opt-in path (explicit session id provided)
    if (!session_id || typeof session_id !== "string") {
      throw new Error("Valid session_id is required")
    }

    // Check if this is a lazy agent session - if so, deny opt-in
    if (isLazyAgentSession(session_id)) {
      throw new Error("Worktree opt-in is not available for lazy agent sessions. Worktree functionality is automatically enabled for lazy agents.")
    }

    optInToWorktree(session_id)
    return `Session ${session_id} has opted into worktree functionality`
  },
})

