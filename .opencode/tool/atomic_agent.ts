import { tool } from "@opencode-ai/plugin"
import { getAgentIdentity } from "../utils/identity-helper.ts"

// Helper to run tmux commands and return { stdout, stderr, exitCode }
async function runTmux(cmd: string[]) {
  const process = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ])
  await process.exited
  return { stdout, stderr, exitCode: process.exitCode }
}

export const list_sessions = tool({
  description: "List tmux sessions for this agent",
  args: {},
  async execute(_args, context) {
    const identity = await getAgentIdentity(context)
    // session name not needed for listing, but keep identity check to ensure context
    void identity

    const { stdout, stderr, exitCode } = await runTmux(["tmux", "ls"]) 
    if (exitCode !== 0) return `Error: ${stderr.trim()}`
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
    const identity = await getAgentIdentity(context)
    const sessionName = `${identity.middleName}-${identity.hash}`

    const tmux_cmd = ["tmux", "new-session", "-s", sessionName]
    if (!attach) tmux_cmd.push("-d")
    if (command_to_run) tmux_cmd.push(command_to_run)

    const { stdout, stderr, exitCode } = await runTmux(tmux_cmd)
    if (exitCode !== 0) return `Error: ${stderr.trim()}`
    return stdout.trim() || `Session ${sessionName} created`
  },
})

export const kill_session = tool({
  description: "Kill this agent's tmux session",
  args: {},
  async execute(_args, context) {
    const identity = await getAgentIdentity(context)
    const sessionName = `${identity.middleName}-${identity.hash}`

    const { stdout, stderr, exitCode } = await runTmux(["tmux", "kill-session", "-t", sessionName])
    if (exitCode !== 0) return `Error: ${stderr.trim()}`
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
    const identity = await getAgentIdentity(context)
    const sessionName = `${identity.middleName}-${identity.hash}`

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
    const identity = await getAgentIdentity(context)
    const sessionName = `${identity.middleName}-${identity.hash}`

    const tmux_cmd = ["tmux", "send-keys", "-t", sessionName, keys]
    if (send_enter !== false) tmux_cmd.push("Enter")

    const { stdout, stderr, exitCode } = await runTmux(tmux_cmd)
    if (exitCode !== 0) return `Error: ${stderr.trim()}`
    return stdout.trim() || "Keys sent"
  },
})
