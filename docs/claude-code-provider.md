# Claude Code provider (Claude subscription via the local CLI)

Status: **approved 2026-10-24; in progress.** Local feature; not submitted upstream. Built on the full upstream PR #61 (10 commits) plus the gaps listed under Decisions; see the commit log.

## Goal

Use the learner's Claude subscription (Pro/Max) as a model provider without an
Anthropic API key. LearnHarness never performs a Claude login and never reads,
stores or forwards Claude credentials. It runs the learner's own installed
Claude Code CLI (`claude.exe -p`) as a model engine; Claude Code authenticates
itself with whatever account `claude auth login` signed in.

Anthropic forbids third-party Claude.ai OAuth (the approach of upstream PR #13).
Driving the official CLI is the more defensible route, but Anthropic has not
explicitly approved another app's agent loop driving it. The owner accepts that.

## Decisions (owner, 2026-10-24)

| Topic | Decision |
|---|---|
| Tool calls | **Pause & resume** — one live CLI process per agent run; a tool call ends the pi step and the MCP call is held open until the harness supplies the result. |
| Code base | **Cherry-pick upstream PR #61's 4 commits** (binary lookup, catalog, transcript replay, MCP SDK dependency, tests), then build on them. |
| Background work | **Always allowed** — research/demo/visual/pdf jobs may use the provider like any API-key provider; each job gets its own process. |
| Settings UI | **Status row** in Settings → Providers → Subscriptions, beside ChatGPT. No login button. |
| Models | **Aliases only**: `opus`, `sonnet`, `haiku` (resolved by the CLI to the latest model the plan allows, at process start). |

## Verified on this machine (feasibility spike, 2026-10-24, CLI 2.1.310)

- Subscription auth works headless with `ANTHROPIC_API_KEY` removed from the
  child env (`apiKeySource: "none"`). `--bare` is unusable (API key only).
- `--system-prompt` fully replaces Claude Code's prompt.
- `--tools ""` leaves only our MCP tools; they surface as `mcp__learnharness__<name>`.
- **`--safe-mode` drops `--mcp-config` servers → must NOT be used.**
- Every MCP `tools/call` carries `params._meta["claudecode/toolUseId"]` equal to
  the stream's `tool_use` id → **exact** call↔result matching.
- Parallel `tool_use` blocks are executed by the CLI **sequentially** (call N+1
  is sent only after call N is answered). The step's full tool list is known
  from the stream at `message_delta` `stop_reason: "tool_use"`.
- **Default MCP tool timeout is 60 s** (then the model retries). With
  `MCP_TOOL_TIMEOUT=3600000` a call held 150 s resumed cleanly.
- Auto-memory is on by default; `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` turns it
  off, and no `~/.claude/projects/*` folders are left behind.
- Stream events: `system:init`, `stream_event` (`message_start`,
  `content_block_start/delta/stop` for `thinking` / `text` / `tool_use`,
  `signature_delta`, `input_json_delta`, `message_delta`, `message_stop`),
  `assistant`, `user` (tool results echo), `rate_limit_event`, `result`.

## CLI invocation

One process per agent run (not per chat). Empty app-owned working directory
(`os.tmpdir()/learnharness-claude-code/`, created once, kept empty).

```
claude.exe -p --verbose
  --input-format stream-json --output-format stream-json --include-partial-messages
  --model <opus|sonnet|haiku> --effort <low|medium|high|xhigh|max>
  --system-prompt <teacher system prompt>
  --tools "" --strict-mcp-config --mcp-config <inline JSON: one http server>
  --allowedTools mcp__learnharness__<each tool>  --permission-prompts none
  --setting-sources "" --disable-slash-commands --no-session-persistence
```

Child env = parent env **minus** `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`,
`ANTHROPIC_OAUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `CLAUDE_CODE_USE_BEDROCK`,
`CLAUDE_CODE_USE_VERTEX` (LearnHarness reflects `auth.json` keys into its own
env, so without this the CLI would silently bill an API key), **plus**
`MCP_TOOL_TIMEOUT=3600000`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`.

The user turn is written to stdin as one stream-json `user` line (PR #61's
`toStreamJsonLine`); stdin stays open for the life of the run.

## Architecture

New files under `src/agent/claude-code/` (from PR #61 unless marked new):

| File | Role |
|---|---|
| `constants.ts` | provider id `claude-code`, api `claude-code-cli`, error enum |
| `binary.ts` | find `claude.exe` (PATH + known dirs) |
| `provider.ts` | pi `Provider` + the 3 alias models (cost 0, thinking map, 1M context) |
| `transcript.ts` | pi transcript → one replay user message (text + images) |
| `mcp-bridge.ts` *(new)* | per-process loopback MCP server (`127.0.0.1`, random port, random bearer token, `@modelcontextprotocol/sdk` Streamable HTTP). Lists the run's current tools (pi TypeBox schemas are JSON Schema already). `tools/call` → hands `{toolUseId, name, args}` to the session and awaits its result. |
| `session.ts` *(new)* | one live CLI process: spawn, stdout line parser, event translation, held-call table, kill. |
| `stream.ts` *(new)* | the pi `StreamFunction`: resume-or-spawn, emits `AssistantMessageEventStream`. |
| `status.ts` *(new)* | `claude --version` + `claude auth status --json` → cached status for catalog + Settings. |

Registration: the provider is added to the `piModels()` collection
(`src/agent/models.ts`) so `models.getModel("claude-code", "opus")` and
`streamSimple` resolve natively — no special case in `piEngineForSpec`.

### One step (one `streamFn` call)

1. **Resume check.** Take the context's last assistant message. If its tool-call
   ids are exactly the pending ids of a paused session **and** the only newer
   messages are the matching tool results → **resume**: answer the held MCP
   call(s) with those results (in the CLI's sequential order; results for calls
   not yet requested are buffered and answered on arrival) and keep reading.
2. **Otherwise spawn.** Kill any paused session with the same `sessionId`
   (the chat id — one live process per chat), spawn a new process, and send
   the full transcript via `toClaudeInput` (single message unlabelled; history
   labelled `[user]` / `[assistant]` / `[tool call …]` / `[tool result …]`).
   This covers: new user message, question answers, steering, compaction,
   app restart, model/effort change, crashed or reaped process.
3. **Translate events** to pi events on a fresh `AssistantMessage`
   (`provider: "claude-code"`, `api: "claude-code-cli"`):
   - `thinking` blocks → `thinking_start/delta/end`;
   - `text` → `text_start/delta/end`;
   - `tool_use` → `toolcall_start/delta/end`, name with the
     `mcp__learnharness__` prefix stripped, id = the CLI's `toolu_…` id;
   - usage from `message_start` / `message_delta` → `Usage` (input, output,
     cacheRead, cacheWrite, reasoning = `thinking_tokens`), cost all 0.
4. **End of step.**
   - `message_delta` `stop_reason: "tool_use"` → `done` with `toolUse`; session
     becomes *paused*, pending ids = that message's tool ids.
   - `end_turn` → `done` with `stop`; then close stdin and let the process exit
     after `result`.
   - `max_tokens` → `done` with `length`.
   - `result` with `is_error` / non-zero exit / stderr auth text → `error`.

### Lifecycle and cleanup

- **Abort** (`options.signal`): kill the process tree (`taskkill /T /F` on
  Windows, `SIGKILL` elsewhere), reject held MCP calls, emit `error`/`aborted`.
- **Run ended without resume** (question tools return `terminate: true`, so the
  harness never calls back): the paused process is killed when the next step for
  the same `sessionId` spawns, or by the **idle reaper after 10 minutes**.
- **Server shutdown:** kill all sessions (process `exit` hook).
- **Concurrency:** independent sessions; no global limit (plan rate limits apply
  and surface as errors).
- A held MCP call whose session is killed gets a JSON-RPC error; the CLI is
  being killed anyway.

### Errors (user-facing; never an API-key fallback)

| Condition | Message |
|---|---|
| CLI not found | "Claude Code CLI not found. Install Claude Code, then Recheck in Settings → Providers." |
| Not signed in (`loggedIn: false` or CLI auth error) | "Claude Code is not signed in. Run `claude auth login` in a terminal, then Recheck." |
| Plan limit (`rate_limit_event` rejected / 429 text) | "Claude plan usage limit reached. See https://claude.ai/settings/usage. No API-key fallback was used." |
| Anything else | "Claude Code request failed: <CLI's own message>" |

## Catalog, pricing, UI

- `src/server/model-catalog.ts` `catalogProviders()` gains
  `{ id: "claude-code", envVar: "", keyPresent: cliFound && loggedIn }` (cached
  status, refreshed on Recheck and every 60 s at most), so the picker shows the
  3 aliases only when usable.
- `src/server/pricing.ts`: `claude-code` models price as **null** (unknown /
  subscription, same as ChatGPT), never as API rates; the cost meter shows "—".
- `components/settings/model-menu.tsx`: price label **"Claude plan"**.
- `components/settings/claude-code-connection.tsx` *(new)*, rendered in the
  Subscriptions group of `keys-section.tsx` under ChatGPT:
  - CLI: "Found · v2.1.310" or "Not found" + install link;
  - Account: "Signed in as <email> · <subscriptionType>" or "Not signed in —
    run `claude auth login` in a terminal";
  - if `authMethod` is an API key: "Claude Code is using an API key, not your
    subscription";
  - **Recheck** button. Status comes from a new `GET /api/claude-code/status`
    route (server-side; the email is shown only in this row).

## Tests (node:test, no network, no real CLI)

- Cherry-picked PR #61 tests (binary, catalog, transcript).
- Event translation from recorded fixtures (text, thinking, tool, signed-out, plus
  a new parallel-tool fixture from the spike).
- Session with a fake CLI (a Node script emitting fixture lines and making real
  MCP calls to the bridge): pause → resume → finish; buffered sequential results;
  abort kills and rejects; non-matching context spawns fresh; reaper.
- Child env strips Anthropic credentials; `MCP_TOOL_TIMEOUT` set.
- Catalog gating on status; pricing returns null; model-menu label; status row
  renders found / not found / signed out / API-key states.
- Then `npm test`, `tsc --noEmit`, `npm run lint`, and a manual run in the app:
  a teaching turn that calls a tool, a question → answer turn, and a research job.

## Out of scope

Pinned model ids, any Claude credential handling or login UI, upstream submission,
Claude Code's own tools/subagents, keeping one process across user turns.
