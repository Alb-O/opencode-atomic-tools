import { tool } from "@opencode-ai/plugin"
import { getAgentIdentity as getWtAgentIdentity, generateNewWtAgentIdentity } from "../utils/identity-helper.ts"
import {
  ensureRemoteSession,
  describeRemote,
  listRemotes,
  shutdownRemote,
  runShell,
} from "../utils/opencode-remote.ts"
import { markWtAgentSession, optInToWorktree, isWtAgentSession, optOutOfWorktree } from "../utils/worktree-session.ts"

export const list_sessions = tool({
  description: "List wt_agent sessions.",
  args: {},
  async execute(_args, context) {
    // Keep identity check to ensure context is valid
    await getWtAgentIdentity(context)

    const rems = listRemotes()
    // Filter for wt_agent sessions (those marked in worktree-session.ts)
    const wtAgentRemotes = rems.filter((r) => {
      // Check if this remote name matches wt_agent session pattern
      const wtAgentPattern = /^[a-z]+-[a-f0-9]{8}$/
      return wtAgentPattern.test(r.name)
    })
    
    if (!wtAgentRemotes || wtAgentRemotes.length === 0) return "No sessions"

    return (
      wtAgentRemotes
        .map((info) =>
          info.active
            ? `Session ${info.name} active at ${info.url}`
            : `Session ${info.name} exists but not active`
        )
        + "\n\nUse the 'wt_agent_send_prompt' tool to instruct the agent, or wt_agent_worktree_jump_in to check its worktree."
    )
  },
})

export const new_session = tool({
  description: "Create a new unique worktree agent (wt_agent) and give it a task. The agent will operate in a separate git worktree nested in `.agent/wt/<session_name>`.",
  args: {
    initial_prompt: tool.schema.string().describe("Initial prompt to give the wt_agent. Must be a detailed & highly technical, describe the agent's goals and relevant context."),
  },
  async execute(args, context) {
    const { initial_prompt } = args
    if (!initial_prompt || String(initial_prompt).trim().length === 0) {
      throw new Error(
        "Initial prompt is required. Please include a detailed message describing the agent's goals and relevant context."
      )
    }
    const baseIdentity = await getWtAgentIdentity(context)
    const sessionName = `${baseIdentity.middleName}-${baseIdentity.hash}`
    // Mark this session as a wt_agent session to enable worktree wrapping
    markWtAgentSession(sessionName)
    // Ensure an opencode remote session exists for this agent (starts server + session)
    await ensureRemoteSession(sessionName)

    // Start the agent shell prompt but don't block for its full completion.
    // Wait a short time for a quick reply — if we get one, return it to
    // the caller, otherwise detach the work silently.
    const runP = runShell(sessionName, initial_prompt)
    const TIMEOUT_MS = 200
    const TIMEOUT_SENTINEL = Symbol("timeout")

    try {
      const raced = await Promise.race([
        runP,
        new Promise((res) => setTimeout(() => res(TIMEOUT_SENTINEL), TIMEOUT_MS)),
      ])

      if (raced !== TIMEOUT_SENTINEL) {
        const reply = raced as unknown as string
        if (reply && reply !== "No messages") return reply
        // If it returned but had no text, fall-through and return created
      }
    } finally {
      void runP.catch(() => {})
    }

    return `Session ${sessionName} created`
  },
})

export const kill_session = tool({
  description: "Kill a wt_agent session",
  args: {
    session_id: tool.schema.string().describe("The session ID of the wt_agent to kill"),
  },
  async execute(args, context) {
    const { session_id } = args
    if (!session_id || String(session_id).trim().length === 0) {
      throw new Error(
        "Session ID is required. Please provide the session ID of the wt_agent to kill."
      )
    }

    const ok = await shutdownRemote(session_id)
    if (!ok) return `Session ${session_id} not found`
    return `Session ${session_id} killed`
  },
})

export const send_prompt = tool({
  description: "Send a prompt message to an existing session agent",
  args: {
    prompt: tool.schema.string().describe("Prompt text to send to the existing agent session"),
    session_id: tool.schema.string().optional().describe("Specific session ID to send prompt to (optional - will use most recent if not provided)"),
  },
  async execute(args, context) {
    const { prompt, session_id } = args
    if (!prompt || String(prompt).trim().length === 0) {
      throw new Error(
        "Prompt is required. Please include a detailed message describing what you want the agent to do."
      )
    }

    let sessionName: string | undefined
    
    if (session_id) {
      sessionName = session_id
    } else {
      // Find the most recent wt_agent session
      const rems = listRemotes()
      const wtAgentRemotes = rems.filter((r) => {
        const wtAgentPattern = /^[a-z]+-[a-f0-9]{8}-[a-f0-9]{4}$/
        return wtAgentPattern.test(r.name) && r.active
      })
      
      if (!wtAgentRemotes || wtAgentRemotes.length === 0) return "No active wt_agent sessions found"
      
      // Use the first (most recent) active session
      sessionName = wtAgentRemotes[0].name
    }
    
    const info = describeRemote(sessionName)
    if (!info || !info.active) return `Session ${sessionName} not running`

    const reply = await runShell(sessionName, prompt)
    if (reply && reply !== "No messages") return reply
    return `Session ${sessionName} responded without text`
  },
})

export const worktree_jump_in = tool({
  description: "Jump in/out of a wt_agent's worktree. Check wt_agent's work before merging into main.",
  args: {
    session_id: tool.schema.string().describe("The session ID to jump into the wt_agent's worktree; leave empty to switch back to main"),
  },
  async execute(args, context) {
    // Allow calling with no session_id or an empty string to jump out (back to non-worktree)
    const raw = (args as any)?.session_id as unknown;
    const session_id = typeof raw === "string" ? raw.trim() : raw ? String(raw).trim() : "";

    // Jump out: no session id provided -> switch back to non-worktree
    if (!session_id) {
      const current = (context as any).sessionID as string | undefined;
      if (!current) {
        throw new Error("No session context available to jump out")
      }
      if (isWtAgentSession(current)) {
        throw new Error("Cannot switch a wt_agent to a the main session; wt_agents always use worktrees.")
      }
      optOutOfWorktree(current);
      return `Jumped back to the main, non-worktree session`;
    }

    // Check if this is a wt_agent session - if so, deny jumping in
    if (isWtAgentSession(session_id)) {
      throw new Error("Worktree jumping is not available for wt_agent sessions.")
    }

    optInToWorktree(session_id)
    return `Jumped into wt_agent's worktree: ${session_id}`
  },
})

