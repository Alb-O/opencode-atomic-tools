import { tool } from "@opencode-ai/plugin"
import { getAgentIdentity } from "../plugin/shared/identity-helper.ts"

export default tool({
  description: "Manage agents with tmux sessions",
  args: {
    command: tool.schema.string().describe("Tmux subcommand to execute (list-sessions, new-session, kill-session, capture-pane, send-keys)"),
    keys: tool.schema.string().optional().describe("Keys to send to tmux session"),
    command_to_run: tool.schema.string().optional().describe("Command to run in new session"),
  },
  async execute(args, context) {
    const { command, keys, command_to_run } = args
    
    // Always use generated identity for session naming
    const identity = await getAgentIdentity(context)
    const sessionName = `${identity.middleName}-${identity.hash}`
    
  let tmux_cmd = ["tmux"]
  // If capture-pane is requested, we may set a capture limit (lines to capture).
  // We'll allow passing a numeric limit in `keys` when using capture-pane; default is 200.
  let captureLimit: number | undefined
    
    switch (command) {
      case "list-sessions":
        tmux_cmd.push("ls")
        break
        
      case "new-session":
        tmux_cmd.push("new-session", "-s", sessionName)
        if (command_to_run) {
          tmux_cmd.push(command_to_run)
        }
        break
        
      case "kill-session":
        tmux_cmd.push("kill-session", "-t", sessionName)
        break
        
      case "capture-pane":
        // Determine how many lines to capture. Allow override via `keys` string (number).
        {
          let limit = 200
          if (keys) {
            const parsed = parseInt(keys, 10)
            if (!Number.isNaN(parsed) && parsed > 0) limit = parsed
          }
          captureLimit = limit
          // -p prints to stdout, -J joins wrapped lines, -S -N starts N lines from bottom
          tmux_cmd.push("capture-pane", "-t", sessionName, "-p", "-J", "-S", `-${limit}`)
        }
        break
        
      case "send-keys":
        if (!keys) {
          return "Error: keys are required for send-keys"
        }
        tmux_cmd.push("send-keys", "-t", sessionName, keys)
        break
        
      default:
        return `Error: Unknown command '${command}'. Supported commands: list-sessions, new-session, kill-session, capture-pane, send-keys`
    }
    
    try {
      const process = Bun.spawn(tmux_cmd, {
        stdout: "pipe",
        stderr: "pipe"
      })
      
      const [stdout, stderr] = await Promise.all([
        new Response(process.stdout).text(),
        new Response(process.stderr).text()
      ])
      
      await process.exited
      
      if (process.exitCode !== 0) {
        return `Error: ${stderr.trim()}`
      }

      // If we captured the pane, post-process the output to remove blank
      // lines and lines that don't contain printable ASCII characters.
      if (command === "capture-pane") {
        const lines = stdout.split(/\r?\n/).map(l => l.trim())
        // Keep lines that have at least one printable ASCII character
        let filtered = lines.filter(l => l.length > 0 && /[ -~]/.test(l))
        if (typeof captureLimit === "number" && captureLimit > 0) {
          filtered = filtered.slice(-captureLimit)
        }
        const out = filtered.join("\n").trim()
        return out || "No useful output captured"
      }

      return stdout.trim() || "Command executed successfully"
    } catch (error) {
      return `Error executing tmux command: ${error instanceof Error ? error.message : String(error)}`
    }
  },
})