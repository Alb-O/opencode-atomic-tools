## Overview

- Lazy Tools wraps the built-in `edit` and `write` tool IDs with custom plugins so the runtime routes requests through our handlers.
- Respect the SDK contract by returning `Promise<string>` from `execute` while still delivering diff metadata for the TUI renderer.
- Bridge the metadata gap by caching results per tool call and overwriting the host callback payload.

## Runtime Expectations

- The plugin SDK types still require `execute` to resolve to a string.
- The host fires `context.metadata({ title?, metadata? })` opportunistically during execution.
- `tool.execute.after` receives the final `{ title, output, metadata }` object that becomes `toolPart.state`.

## Lazy Tools Implementation Notes

1. Deterministic branches: reuse `createDeterministicBranch` so each tool call switches to a session-scoped branch before writing.
2. File writes and commits: use `Bun.write` (edit/write) followed by `commitFile` to stage and commit, capturing the staged diff from git.
3. Diff formatting: for edits, generate a unified diff with `createTwoFilesPatch` and trim indentation to match the built-in renderer.
4. Metadata hook: call `context.metadata({ title, metadata })` with repo-relative paths to populate the live tool state during execution.
5. Result cache: store `{ title, output, metadata }` by `context.callID` in `shared/edit-notes.ts` so the final callback can reach the data even though `execute` returns a string.
6. Callback patch: override `"tool.execute.after"` in `index.ts`, retrieve the cached entry, and replace the host-provided result before it is persisted.
7. Tool IDs: expose the handlers under `edit` and `write` so they replace the stock tools (no new IDs needed).

## Usage

- Ensure `edit` and `write` are enabled in the OpenCode config (they are by default).
- Restart OpenCode so the plugin loads.
- When agents call `edit` or `write`; the TUI receives the familiar diff rendering because the metadata is injected into the normal pipeline.

## Maintenance Tips

- Keep the cache key (`context.callID`) in sync with any upstream SDK changes.
- Drop the cache entry after each use to avoid leaking memory across sessions.
- When updating the diff logic, verify that the unified header (`--- a/`, `+++ b/`) and trimmed content still match the TUI parser expectations.
