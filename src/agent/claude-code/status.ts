import { execFile } from "node:child_process";

import type { ClaudeCodeStatus } from "../../core/contracts/claude-code.ts";
import { getClaudeBinary } from "./binary.ts";
import { toClaudeEnv } from "./stream.ts";

// Each check spawns the CLI twice (about 2–3 s cold), so callers share one cached status.
const STATUS_MAX_AGE_MS = 60_000;
const COMMAND_TIMEOUT_MS = 15_000;

export type RunStatusCommand = (binary: string, args: string[]) => Promise<string>;

// `claude auth status` exits non-zero when signed out but still prints its JSON.
function runStatusCommand(binary: string, args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		const options = { timeout: COMMAND_TIMEOUT_MS, windowsHide: true, env: toClaudeEnv(process.env) };
		execFile(binary, args, options, (error, stdout) => (error && !stdout.trim() ? reject(error) : resolve(stdout)));
	});
}

/** Test seam (runner.ts's pdfModelOverride idiom). */
export const claudeCodeStatusCommand: { current: RunStatusCommand } = { current: runStatusCommand };

let cached: ClaudeCodeStatus | null = null;
let inFlight: Promise<ClaudeCodeStatus> | null = null;

function emptyStatus(found: boolean): ClaudeCodeStatus {
	return { found, version: null, loggedIn: false, authMethod: null, email: null, subscriptionType: null, error: null, checkedAt: Date.now() };
}

function parseVersion(stdout: string): string | null {
	return stdout.trim().split(/\s+/)[0] || null;
}

function optionalString(value: unknown): string | null {
	return typeof value === "string" && value ? value : null;
}

type AuthFields = Pick<ClaudeCodeStatus, "loggedIn" | "authMethod" | "email" | "subscriptionType">;

function parseAuth(stdout: string): AuthFields {
	const auth = JSON.parse(stdout) as Record<string, unknown>;

	return {
		loggedIn: auth.loggedIn === true,
		authMethod: optionalString(auth.authMethod),
		email: optionalString(auth.email),
		subscriptionType: optionalString(auth.subscriptionType),
	};
}

async function readStatus(): Promise<ClaudeCodeStatus> {
	const binary = getClaudeBinary();
	if (!binary) return emptyStatus(false);

	const run = claudeCodeStatusCommand.current;
	const [version, auth] = await Promise.all([
		run(binary, ["--version"]).then(parseVersion, () => null),
		run(binary, ["auth", "status", "--json"])
			.then(parseAuth)
			.catch((error: unknown) => (error instanceof Error ? error : new Error(String(error)))),
	]);

	if (auth instanceof Error) return { ...emptyStatus(true), version, error: `claude auth status failed: ${auth.message}` };

	return { ...emptyStatus(true), version, ...auth };
}

function isFresh(status: ClaudeCodeStatus): boolean {
	return Date.now() - status.checkedAt < STATUS_MAX_AGE_MS;
}

function refreshStatus(): Promise<ClaudeCodeStatus> {
	inFlight ??= readStatus()
		.then((status) => {
			cached = status;
			return status;
		})
		.finally(() => {
			inFlight = null;
		});

	return inFlight;
}

/** The CLI status, re-read when older than a minute or when refresh is set (the Recheck button). */
export function getClaudeCodeStatus({ refresh = false }: { refresh?: boolean } = {}): Promise<ClaudeCodeStatus> {
	if (!refresh && cached && isFresh(cached)) return Promise.resolve(cached);

	return refreshStatus();
}

/** Synchronous read for the catalog: the last completed status, or null before the first check.
 *  No side effects; getClaudeCodeStatus() is what refreshes it. */
export function cachedClaudeCodeStatus(): ClaudeCodeStatus | null {
	return cached;
}

/** Test seam: forget the cached status. */
export function resetClaudeCodeStatus(): void {
	cached = null;
	inFlight = null;
}
