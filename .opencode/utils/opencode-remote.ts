import net from "node:net";
import { createOpencodeClient } from "@opencode-ai/sdk";
import type { SessionMessagesResponse, Part } from "@opencode-ai/sdk";

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
  throw new Error("Remote opencode server did not become ready in time");
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
    proc.kill();
    remotes.delete(name);
    throw error;
  });
  return remote;
}

async function ensureSession(name: string): Promise<RemoteSession> {
  const remote = await ensureServer(name);
  if (!remote.sessionId) {
    const result = await remote.client.session.create({
      body: { title: `Lazy Agent ${name}` },
      responseStyle: "data",
    });
    if ("data" in result && result.data) {
      remote.sessionId = result.data.id;
    } else {
      throw new Error(`Failed to create session: ${String((result as any).error ?? "unknown")}`);
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

export async function runShell(name: string, agent: string, command: string) {
  const remote = await ensureSession(name);
  await remote.client.session.shell({
    path: { id: remote.sessionId },
    body: { agent, command },
    responseStyle: "data",
  });
}

function isTextPart(part: Part): part is Extract<Part, { type: "text"; text: string }> {
  const maybe = (part as unknown as { text?: unknown }).text;
  return part.type === "text" && typeof maybe === "string";
}

export async function captureOutput(name: string, limit: number) {
  const remote = await ensureSession(name);
  const resp = await remote.client.session.messages({
    path: { id: remote.sessionId },
    responseStyle: "data",
  });
  const rows: SessionMessagesResponse = "data" in resp && resp.data ? resp.data : [];
  const text = rows
    .flatMap((entry) => entry.parts ?? [])
    .filter(isTextPart)
    .map((part) => part.text)
    .filter((value) => value.length > 0)
    .join("\n");
  if (!text) {
    return "No messages";
  }
  const lines = text.split(/\r?\n/);
  const slice = limit > 0 ? lines.slice(-limit) : lines;
  const result = slice.join("\n").trim();
  return result || "No messages";
}
