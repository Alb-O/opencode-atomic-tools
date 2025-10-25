import { tool } from "@opencode-ai/plugin"
import { getAgentIdentity } from "../utils/identity-helper.ts"

// Helper to run tmux commands and return { stdout, stderr, exitCode }
async function runTmux(cmd: string[]) {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" })
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  await proc.exited
  return { stdout: out, stderr: err, exitCode: proc.exitCode }
}

async function agentSession(context: { sessionID: string; agent: string }) {
  const identity = await getAgentIdentity(context)
  return `${identity.middleName}-${identity.hash}`
}

export const list_sessions = tool({
  description: "List tmux sessions for this agent",
  args: {},
  async execute(_args, context) {
    // session name not needed for listing, but keep identity check to ensure context
    await getAgentIdentity(context)

    const { stdout, stderr, exitCode } = await runTmux(["tmux", "ls"]) 
    if (exitCode !== 0) {
      if (stderr.includes("no server running")) return "No sessions"
      return `Error: ${stderr.trim()}`
    }
    return stdout.trim() || "No sessions"
  },
})

export const new_session = tool({
  description: "Create a new tmux session for this agent (detached by default)",
  args: {
    command_to_run: tool.schema.string().optional().describe("Optional command to run in the new session"),
    attach: tool.schema.boolean().optional().describe("If true, attach to the session after creating it (default false)"),
  },
  async execute(args, context) {
    const { command_to_run, attach } = args
    const sessionName = await agentSession(context)

    const create = await runTmux(["tmux", "new-session", "-d", "-s", sessionName])
    if (create.exitCode !== 0) return `Error: ${create.stderr.trim()}`

    const option = await runTmux(["tmux", "set-option", "-t", sessionName, "remain-on-exit", "on"])
    if (option.exitCode !== 0) return `Error: ${option.stderr.trim()}`

    if (command_to_run) {
      const send = await runTmux(["tmux", "send-keys", "-t", sessionName, command_to_run, "Enter"])
      if (send.exitCode !== 0) return `Error: ${send.stderr.trim()}`
    }

    if (attach) return `Session ${sessionName} created. Run "tmux attach -t ${sessionName}" to attach.`
    return `Session ${sessionName} created`
  },
})

export const kill_session = tool({
  description: "Kill this agent's tmux session",
  args: {},
  async execute(_args, context) {
    const sessionName = await agentSession(context)

    const { stdout, stderr, exitCode } = await runTmux(["tmux", "kill-session", "-t", sessionName])
    if (exitCode !== 0) {
      if (stderr.includes("failed to connect to server")) return `Session ${sessionName} not found`
      if (stderr.includes("no server running")) return `Session ${sessionName} not found`
      return `Error: ${stderr.trim()}`
    }
    return stdout.trim() || `Session ${sessionName} killed`
  },
})

export const capture_pane = tool({
  description: "Capture recent lines from the agent's tmux session pane and filter out blank/garbage lines",
  args: {
    limit: tool.schema.number().optional().describe("Number of most recent lines to capture (default 200)"),
  },
  async execute(args, context) {
    const limit = (typeof args.limit === 'number' && args.limit > 0) ? Math.floor(args.limit) : 200
    const sessionName = await agentSession(context)

    const check = await runTmux(["tmux", "has-session", "-t", sessionName])
    if (check.exitCode !== 0) {
      if (check.stderr.includes("no server running")) return `Session ${sessionName} not running`
      return `Error: ${check.stderr.trim()}`
    }

    // Use -p to print to stdout, -J to join wrapped lines, -S -<limit> to start <limit> lines from bottom
    const { stdout, stderr, exitCode } = await runTmux(["tmux", "capture-pane", "-t", sessionName, "-p", "-J", "-S", `-${limit}`])
    if (exitCode !== 0) return `Error: ${stderr.trim()}`

    const lines = stdout.split(/\r?\n/).map(l => l.trim())
    // Keep lines that have at least one printable ASCII character
    const filtered = lines.filter(l => l.length > 0 && /[ -~]/.test(l)).slice(-limit)
    const out = filtered.join("\n").trim()
    return out || "No useful output captured"
  },
})

export const send_keys = tool({
  description: "Send keystrokes to the agent's tmux session",
  args: {
    keys: tool.schema.string().describe("Keys to send to the session"),
    send_enter: tool.schema.boolean().optional().describe("Whether to send an Enter after the keys (default true)"),
  },
  async execute(args, context) {
    const { keys, send_enter } = args
    if (!keys) return "Error: keys are required"
    const sessionName = await agentSession(context)

    const check = await runTmux(["tmux", "has-session", "-t", sessionName])
    if (check.exitCode !== 0) {
      if (check.stderr.includes("no server running")) return `Session ${sessionName} not running`
      return `Error: ${check.stderr.trim()}`
    }

    const tmux_cmd = ["tmux", "send-keys", "-t", sessionName, keys]
    if (send_enter !== false) tmux_cmd.push("Enter")

    const { stdout, stderr, exitCode } = await runTmux(tmux_cmd)
    if (exitCode !== 0) return `Error: ${stderr.trim()}`
    return stdout.trim() || "Keys sent"
  },
})
