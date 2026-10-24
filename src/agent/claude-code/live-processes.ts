/** sessionId is pi's stream sessionId: the chat id for the teacher, a fresh uuid per subagent run. */
export type LiveProcess = { toolCallIds: string[]; sessionId?: string; kill(): void };

// pi runs a message's tools (each capped at 30s by tool-execute) and calls back well within this;
// it stays under MCP_TOOL_TIMEOUT so an orphaned process is killed before the CLI gives up on its own.
export const LIVE_PROCESS_IDLE_TIMEOUT_MS = 10 * 60_000;

/** Test seam (runner.ts's pdfModelOverride idiom). */
export const liveProcessIdleTimeoutMs = { current: LIVE_PROCESS_IDLE_TIMEOUT_MS };

// Each live process mapped to the timer that kills it if pi never calls back.
const liveProcesses = new Map<LiveProcess, NodeJS.Timeout>();

export function addLiveProcess(process: LiveProcess): void {
	const timer = setTimeout(() => {
		removeLiveProcess(process);
		process.kill();
	}, liveProcessIdleTimeoutMs.current);

	timer.unref();

	liveProcesses.set(process, timer);
}

function hasSameIds(ids: string[], otherIds: string[]): boolean {
	return ids.length === otherIds.length && ids.every((id) => otherIds.includes(id));
}

export function getLiveProcess(toolCallIds: string[]): LiveProcess | null {
	if (toolCallIds.length === 0) return null;

	for (const process of liveProcesses.keys()) {
		if (hasSameIds(process.toolCallIds, toolCallIds)) return process;
	}

	return null;
}

// A session runs one agent turn at a time, so a held process of the same session that the new
// step didn't continue (e.g. the run ended on a question tool) will never be continued.
export function killSessionLiveProcesses(sessionId: string): void {
	for (const process of [...liveProcesses.keys()]) {
		if (process.sessionId !== sessionId) continue;

		removeLiveProcess(process);
		process.kill();
	}
}

export function removeLiveProcess(process: LiveProcess): void {
	clearTimeout(liveProcesses.get(process));
	liveProcesses.delete(process);
}
