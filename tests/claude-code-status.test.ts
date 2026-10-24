/**
 * Claude Code CLI status (src/agent/claude-code/status.ts): what `claude
 * --version` and `claude auth status --json` report, cached for the catalog
 * and the Settings row. The command runner is stubbed; no real CLI runs.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test, { type TestContext } from "node:test";

import {
	cachedClaudeCodeStatus,
	claudeCodeStatusCommand,
	getClaudeCodeStatus,
	resetClaudeCodeStatus,
	type RunStatusCommand,
} from "../src/agent/claude-code/status.ts";

const VERSION_OUTPUT = "2.1.310 (Claude Code)\n";
const SIGNED_IN = { loggedIn: true, authMethod: "claude.ai", email: "learner@example.com", subscriptionType: "pro", orgId: "org" };

/** PATH and the home dirs (USERPROFILE/APPDATA on Windows) → a temp dir that
 *  holds a claude binary only when installed is true. */
function useClaudeInstalled(t: TestContext, installed: boolean): void {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-status-"));
	const names = ["PATH", "HOME", "USERPROFILE", "APPDATA", "npm_config_prefix"] as const;
	const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));

	if (installed) fs.writeFileSync(path.join(dir, process.platform === "win32" ? "claude.exe" : "claude"), "#!/bin/sh\n", { mode: 0o755 });
	for (const name of names) process.env[name] = dir;
	delete process.env.npm_config_prefix;

	t.after(() => {
		for (const [name, value] of Object.entries(saved)) {
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
		fs.rmSync(dir, { recursive: true, force: true });
	});
}

/** Stubs the runner; returns the args of every command it ran. */
function useCommand(t: TestContext, run: RunStatusCommand): string[][] {
	const calls: string[][] = [];
	const saved = claudeCodeStatusCommand.current;
	claudeCodeStatusCommand.current = (binary, args) => {
		calls.push(args);
		return run(binary, args);
	};
	resetClaudeCodeStatus();
	t.after(() => {
		claudeCodeStatusCommand.current = saved;
		resetClaudeCodeStatus();
	});
	return calls;
}

function authReplies(auth: object): RunStatusCommand {
	return async (_binary, args) => (args[0] === "--version" ? VERSION_OUTPUT : JSON.stringify(auth));
}

test("a signed-in subscription reports version, account and plan", async (t) => {
	useClaudeInstalled(t, true);
	const calls = useCommand(t, authReplies(SIGNED_IN));

	const status = await getClaudeCodeStatus();

	assert.deepEqual({ ...status, checkedAt: 0 }, {
		found: true,
		version: "2.1.310",
		loggedIn: true,
		authMethod: "claude.ai",
		email: "learner@example.com",
		subscriptionType: "pro",
		error: null,
		checkedAt: 0,
	});
	assert.deepEqual(calls.sort(), [["--version"], ["auth", "status", "--json"]]);
});

test("signed out reports loggedIn false with no error", async (t) => {
	useClaudeInstalled(t, true);
	useCommand(t, authReplies({ loggedIn: false, authMethod: "none" }));

	const status = await getClaudeCodeStatus();

	assert.equal(status.found, true);
	assert.equal(status.loggedIn, false);
	assert.equal(status.email, null);
	assert.equal(status.error, null);
});

test("a missing CLI reports found false without running anything", async (t) => {
	useClaudeInstalled(t, false);
	const calls = useCommand(t, authReplies(SIGNED_IN));

	const status = await getClaudeCodeStatus();

	assert.equal(status.found, false);
	assert.equal(status.loggedIn, false);
	assert.deepEqual(calls, []);
});

test("a failing auth check is reported as an error, not as signed in", async (t) => {
	useClaudeInstalled(t, true);
	useCommand(t, async (_binary, args) => {
		if (args[0] === "--version") return VERSION_OUTPUT;
		throw new Error("spawn EACCES");
	});

	const status = await getClaudeCodeStatus();

	assert.equal(status.found, true);
	assert.equal(status.version, "2.1.310");
	assert.equal(status.loggedIn, false);
	assert.match(status.error ?? "", /claude auth status failed: spawn EACCES/);
});

test("unparseable auth output is reported as an error", async (t) => {
	useClaudeInstalled(t, true);
	useCommand(t, async (_binary, args) => (args[0] === "--version" ? VERSION_OUTPUT : "not json"));

	const status = await getClaudeCodeStatus();

	assert.equal(status.loggedIn, false);
	assert.match(status.error ?? "", /claude auth status failed/);
});

test("the status is cached; refresh re-reads it; concurrent reads share one check", async (t) => {
	useClaudeInstalled(t, true);
	const calls = useCommand(t, authReplies(SIGNED_IN));

	assert.equal(cachedClaudeCodeStatus(), null);
	const [one, two] = await Promise.all([getClaudeCodeStatus(), getClaudeCodeStatus()]);
	assert.equal(one, two);
	assert.equal(calls.length, 2);

	assert.equal(await getClaudeCodeStatus(), one);
	assert.equal(cachedClaudeCodeStatus(), one);
	assert.equal(calls.length, 2);

	const refreshed = await getClaudeCodeStatus({ refresh: true });
	assert.notEqual(refreshed, one);
	assert.equal(calls.length, 4);
});

test("cachedClaudeCodeStatus() never runs the CLI itself", async (t) => {
	useClaudeInstalled(t, true);
	const calls = useCommand(t, authReplies(SIGNED_IN));

	assert.equal(cachedClaudeCodeStatus(), null);
	await new Promise((resolve) => setTimeout(resolve, 20));

	assert.deepEqual(calls, []);
});
