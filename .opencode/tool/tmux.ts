import { tool } from "@opencode-ai/plugin"
import { getAgentIdentity } from "../plugin/shared/identity-helper.ts"

export default tool({
  description: "Tmux wrapper with curated non-interactive subcommands",
  args: {
    command: tool.schema.string().describe("Tmux subcommand to execute (list-sessions, new-session, kill-session, attach-session, send-keys)"),
    keys: tool.schema.string().optional().describe("Keys to send to tmux session"),
    command_to_run: tool.schema.string().optional().describe("Command to run in new session"),
  },
  async execute(args, context) {
    const { command, keys, command_to_run } = args
    
    // Always use generated identity for session naming
    const identity = await getAgentIdentity(context)
    const sessionName = `${identity.middleName}-${identity.hash}`
    
    let tmux_cmd = ["tmux"]
    
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
        
      case "attach-session":
        tmux_cmd.push("attach-session", "-t", sessionName)
        break
        
      case "send-keys":
        if (!keys) {
          return "Error: keys are required for send-keys"
        }
        tmux_cmd.push("send-keys", "-t", sessionName, keys)
        break
        
      default:
        return `Error: Unknown command '${command}'. Supported commands: list-sessions, new-session, kill-session, attach-session, send-keys`
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
      
      return stdout.trim() || "Command executed successfully"
    } catch (error) {
      return `Error executing tmux command: ${error instanceof Error ? error.message : String(error)}`
    }
  },
})