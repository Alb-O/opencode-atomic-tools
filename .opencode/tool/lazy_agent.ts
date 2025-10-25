import { tool } from "@opencode-ai/plugin"
import { getAgentIdentity } from "../utils/identity-helper.ts"
import {
  ensureRemoteSession,
  describeRemote,
  shutdownRemote,
  queueInput,
  runShell,
  captureOutput,
} from "../utils/opencode-remote.ts"

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
    // Ensure an opencode remote session exists for this agent (starts server + session)
    await ensureRemoteSession(sessionName)

    // Queue the initial prompt for the detached agent to consume later when active.
    await queueInput(sessionName, initial_prompt)

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

    await runShell(sessionName, sessionName, prompt)
    return `Prompt sent to ${sessionName}`
  },
})

