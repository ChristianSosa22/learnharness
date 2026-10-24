/**
 * GET /api/claude-code/status — the Claude Code row in Settings → Providers.
 *
 * What the local CLI reports about itself (`claude --version`, `claude auth
 * status`): found, version, signed-in account and plan. LearnHarness never
 * reads Claude credentials; sign-in stays in Claude Code. Cached for a
 * minute; `?refresh=1` (the Recheck button) re-reads it now.
 */
import { getClaudeCodeStatus } from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
	const refresh = new URL(request.url).searchParams.get("refresh") === "1";
	return Response.json(await getClaudeCodeStatus({ refresh }));
}
