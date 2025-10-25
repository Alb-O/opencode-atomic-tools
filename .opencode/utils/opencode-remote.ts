import net from "node:net";
import { createOpencodeClient } from "@opencode-ai/sdk";
import type {
  SessionMessagesResponse,
  Part,
} from "@opencode-ai/sdk";

type Remote = {
  port: number;
  proc: BunProc;
  client: ReturnType<typeof createOpencodeClient>;
  sessionId?: string;
  buffer?: string;
};

type RemoteSession = Remote & { sessionId: string };

type Summary = {
  name: string;
  port: number;
  url: string;
  sessionId?: string;
  active: boolean;
};

const host = "127.0.0.1";
// Minimal process shape for Bun.spawn return value
type BunProc = {
  exited: Promise<number>;
  exitCode: number | null;
  kill: () => void;
  stderr?: ReadableStream | null;
};
const remotes = new Map<string, Remote>();

function alive(proc: BunProc) {
  return proc.exitCode === null;
}

function makeUrl(port: number) {
  return `http://${host}:${port}`;
}

function drain(stream: ReadableStream | null) {
  if (!stream) {
    return;
  }
  (async () => {
    await new Response(stream).arrayBuffer();
  })();
}

function onExit(name: string, proc: BunProc) {
  proc.exited.then(() => {
    const current = remotes.get(name);
    if (current && current.proc === proc) {
      remotes.delete(name);
    }
  });
}

function clientFor(port: number) {
  return createOpencodeClient({
    baseUrl: makeUrl(port),
    fetch: (...args) => fetch(...args),
  });
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, host, () => {
      const address = server.address();
      if (address && typeof address === "object") {
        resolve(address.port);
      } else {
        reject(new Error("Failed to allocate port"));
      }
      server.close();
    });
    server.once("error", reject);
  });
}

async function waitForReady(client: ReturnType<typeof createOpencodeClient>) {
  const start = Date.now();
  const timeout = 15_000;
  while (Date.now() - start < timeout) {
    const ok = await client.session.list({ responseStyle: "data" }).then(
      () => true,
      () => false,
    );
    if (ok) {
      return;
    }
    await Bun.sleep(200);
  }
  throw new Error("Remote opencode server did not get ready in time");
}

async function ensureServer(name: string): Promise<Remote> {
  const existing = remotes.get(name);
  if (existing && alive(existing.proc)) {
    return existing;
  }
  if (existing) {
    remotes.delete(name);
  }
  const port = await freePort();
  const _proc = Bun.spawn(["opencode", "serve", `--port=${port}`], {
    stdout: "ignore",
    stderr: "pipe",
  });
  // Narrow to the minimal BunProc shape we use.
  const proc: BunProc = _proc as unknown as BunProc;
  drain(proc.stderr ?? null);
  onExit(name, proc);
  const client = clientFor(port);
  const remote: Remote = { port, proc, client };
  remotes.set(name, remote);
  await waitForReady(client).catch(async (error) => {
    console.error(`[opencode-remote] ensureServer(${name}): server did not become ready: ${String(error)}`);
    proc.kill();
    remotes.delete(name);
    throw error;
  });
  return remote;
}

async function ensureSession(name: string): Promise<RemoteSession> {
  const remote = await ensureServer(name);
  if (!remote.sessionId) {
    // Create a session with a concise log on success/failure.
    const payload = { title: `wt_agent: ${name}` };
    const result = await remote.client.session.create({ body: payload, responseStyle: "data" }).catch((err) => {
      throw err;
    });

    // Normalise a few common response shapes and extract session id.
    const r = result as any;
    const found = r?.id ?? r?.data?.id ?? r?.session?.id ?? r?.data?.session?.id;
    if (typeof found === "string") {
      remote.sessionId = found;
    } else {
      throw new Error("Failed to create session");
    }
  }
  return remote as RemoteSession;
}

export async function ensureRemoteSession(name: string) {
  const remote = await ensureSession(name);
  return {
    name,
    port: remote.port,
    url: makeUrl(remote.port),
    sessionId: remote.sessionId,
  };
}

export function describeRemote(name: string): Summary | undefined {
  const remote = remotes.get(name);
  if (!remote) {
    return undefined;
  }
  return {
    name,
    port: remote.port,
    url: makeUrl(remote.port),
    sessionId: remote.sessionId,
    active: alive(remote.proc),
  };
}

export function listRemotes(): Summary[] {
  return Array.from(remotes.entries()).map(([name, remote]) => ({
    name,
    port: remote.port,
    url: makeUrl(remote.port),
    sessionId: remote.sessionId,
    active: alive(remote.proc),
  }));
}

export async function shutdownRemote(name: string) {
  const remote = remotes.get(name);
  if (!remote) {
    return false;
  }
  remote.proc.kill();
  remotes.delete(name);
  return true;
}

export async function queueInput(name: string, chunk: string) {
  const remote = await ensureServer(name);
  const next = `${remote.buffer ?? ""}${chunk}`;
  remote.buffer = next;
  return next;
}

export async function flushInput(name: string) {
  const remote = await ensureServer(name);
  const text = remote.buffer ?? "";
  remote.buffer = undefined;
  return text;
}

export async function runShell(name: string, command: string, agent = "build") {
  const remote = await ensureSession(name);

  try {
    const promptBody = {
      agent,
      parts: [
        {
          type: "text" as const,
          text: command,
        },
      ],
    };

    // Send the prompt once. Keep polling the session messages for the reply.
    let resp: any = undefined;
    try {
      resp = await remote.client.session.prompt({ path: { id: remote.sessionId }, body: promptBody, responseStyle: "data" });
    } catch (err) {
      if (!alive(remote.proc)) {
        throw new Error(`Remote process died while prompting (port=${remote.port} session=${remote.sessionId})`);
      }
      throw err;
    }

    // Try to extract text parts from the prompt response first and if
    // nothing is present, poll session.messages for a short timeout.
    function extractTextFromMessages(maybe: any) {
      try {
        // Support multiple shapes:
        // - { data: Message[] }
        // - Message[]
        // - { parts: Part[] } (single message shape returned by prompt)
        let rows: SessionMessagesResponse = [];
        if (maybe == null) {
          rows = [];
        } else if (Array.isArray(maybe)) {
          rows = maybe;
        } else if ("data" in maybe && Array.isArray(maybe.data)) {
          rows = maybe.data;
        } else if (Array.isArray((maybe as any).parts)) {
          // single message returned with top-level parts
          rows = [{ info: (maybe as any).info ?? {}, parts: (maybe as any).parts } as any];
        } else if (Array.isArray((maybe as any).parts ?? (maybe as any).parts)) {
          rows = [{ info: (maybe as any).info ?? {}, parts: (maybe as any).parts } as any];
        } else {
          rows = [];
        }

        const text = rows
          .flatMap((entry) => (entry && Array.isArray(entry.parts) ? entry.parts : []))
          // Accept any part that contains a string `text` field OR a `value` field
          .map((p) => {
            if (!p || typeof p !== "object") return "";
            const t = (p as any).text;
            if (typeof t === "string" && t.length > 0) return t;
            const v = (p as any).value;
            if (typeof v === "string" && v.length > 0) return v;
            return "";
          })
          .filter((v) => v && v.length > 0)
          .join("\n")
          .trim();
        return text || null;
      } catch (e) {
        return null;
      }
    }

    // Try to extract from the immediate response
    const immediate = extractTextFromMessages(resp);
    if (immediate) return immediate;

    // Poll the messages endpoint for a short period to wait for the agent reply
    const pollAttempts = 50; // ~10 seconds @ 200ms
    for (let i = 0; i < pollAttempts; i++) {
      try {
        // If the remote process died while waiting, abort with clear error
        if (!alive(remote.proc)) {
          throw new Error(`Remote process died while waiting for response (port=${remote.port} session=${remote.sessionId})`);
        }

        await Bun.sleep(200);
        const m = await remote.client.session.messages({ path: { id: remote.sessionId }, responseStyle: "data" });
        const t = extractTextFromMessages(m);
        if (t) {
          return t;
        }
      } catch (e) {
        // ignore
      }
    }

    // If we still have no text, return a clear sentinel.
    return "No messages";
  } catch (err) {
    throw err;
  }
}
