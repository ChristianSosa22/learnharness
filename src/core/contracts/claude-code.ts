/** Client-safe Claude Code CLI status (GET /api/claude-code/status). LearnHarness never sees
 *  Claude credentials: everything here is what `claude --version` and `claude auth status` print. */
export interface ClaudeCodeStatus {
	/** The CLI binary was found (PATH plus the usual install locations). */
	found: boolean;
	version: string | null;
	loggedIn: boolean;
	/** "claude.ai" is the subscription; anything else (e.g. an API key) is not. */
	authMethod: string | null;
	email: string | null;
	subscriptionType: string | null;
	/** Why the status could not be read, when the CLI is found but its auth check failed. */
	error: string | null;
	checkedAt: number;
}
