"use client";

import { useCallback, useEffect, useState } from "react";
import type { ClaudeCodeStatus } from "@/src/core";
import { notifySettingsSaved } from "@/components/settings-signal";
import { Button } from "@/components/ui/button";

export const CLAUDE_CODE_INSTALL_URL = "https://code.claude.com/docs/en/setup";
export const CLAUDE_CODE_USAGE_URL = "https://claude.ai/settings/usage";
export const CLAUDE_CODE_NOT_SIGNED_IN = "Not signed in. Run `claude auth login` in a terminal, then Recheck.";
export const CLAUDE_CODE_API_KEY_WARNING = "Claude Code is using an API key, not your subscription.";
const SUBSCRIPTION_AUTH_METHOD = "claude.ai";

function isStatus(value: unknown): value is ClaudeCodeStatus {
	return typeof value === "object" && value !== null && typeof (value as ClaudeCodeStatus).found === "boolean";
}

function planLabel(subscriptionType: string | null): string {
	return subscriptionType ? ` · ${subscriptionType[0]!.toUpperCase()}${subscriptionType.slice(1)} plan` : "";
}

/** Settings → Providers → Subscriptions row: what the local Claude Code CLI reports. No login
 *  here: sign-in stays in Claude Code (`claude auth login`). */
export function ClaudeCodeConnection() {
	const [status, setStatus] = useState<ClaudeCodeStatus | null>(null);
	const [checking, setChecking] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async (refresh: boolean) => {
		setChecking(true);
		setError(null);
		try {
			const response = await fetch(`/api/claude-code/status${refresh ? "?refresh=1" : ""}`, { cache: "no-store" });
			const body: unknown = await response.json();
			if (!response.ok || !isStatus(body)) throw new Error("Couldn't read the Claude Code status.");
			setStatus(body);
			// The picker gates claude-code on this status; let it refetch the catalog.
			if (refresh) notifySettingsSaved("keys");
		} catch (err) {
			setError(err instanceof Error ? err.message : "Couldn't read the Claude Code status.");
		} finally {
			setChecking(false);
		}
	}, []);

	useEffect(() => { void load(false); }, [load]);

	return <div className="flex flex-col gap-1.5 text-xs" data-testid="claude-code-connection">
		<div className="flex flex-wrap items-center gap-3">
			<span className="font-ui text-foreground">Claude Code</span>
			{status?.found && status.version && <span className="font-mono text-[11px] text-muted-foreground" data-testid="claude-code-version">CLI v{status.version}</span>}
			<Button type="button" size="xs" variant="ghost" className="cursor-pointer" data-testid="claude-code-recheck" disabled={checking} onClick={() => void load(true)}>
				{checking ? "Checking…" : "Recheck"}
			</Button>
		</div>
		{status && !status.found && <p className="text-muted-foreground" data-testid="claude-code-not-found">
			Claude Code CLI not found. <a href={CLAUDE_CODE_INSTALL_URL} target="_blank" rel="noreferrer" className="underline underline-offset-2">Install Claude Code</a>, then Recheck.
		</p>}
		{status?.found && status.loggedIn && <p className="text-foreground" data-testid="claude-code-account">
			Signed in as {status.email ?? "Claude account"}{planLabel(status.subscriptionType)}
			<a href={CLAUDE_CODE_USAGE_URL} target="_blank" rel="noreferrer" className="ml-3 text-muted-foreground underline underline-offset-2">Manage usage</a>
		</p>}
		{status?.found && status.loggedIn && status.authMethod !== SUBSCRIPTION_AUTH_METHOD && <p role="alert" className="text-red-400" data-testid="claude-code-api-key-warning">{CLAUDE_CODE_API_KEY_WARNING}</p>}
		{status?.found && !status.loggedIn && !status.error && <p className="text-muted-foreground" data-testid="claude-code-signed-out">{CLAUDE_CODE_NOT_SIGNED_IN}</p>}
		{status?.error && <p role="alert" className="text-red-400" data-testid="claude-code-status-error">{status.error}</p>}
		{error && <p role="alert" className="text-red-400">{error}</p>}
	</div>;
}
