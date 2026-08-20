/**
 * Read-only compatibility probe for a future official Codex CLI engine.
 */

import { execFile } from "node:child_process";
import type { AgentEngineDescriptor } from "./agent-engine";
import {
	type RuntimeResolverOptions,
	resolveCodexRuntime,
} from "./runtime-resolver";

interface CommandResult {
	ok: boolean;
	stdout: string;
	stderr: string;
}

export type CodexCommandRunner = (
	filePath: string,
	args: string[],
) => Promise<CommandResult>;

const CODEX_CAPABILITIES_DISABLED = {
	auth: false,
	sessions: false,
	prompts: false,
	events: false,
	cancel: false,
	diff: false,
} as const;

async function runCommand(
	filePath: string,
	args: string[],
): Promise<CommandResult> {
	return await new Promise((resolve) => {
		execFile(
			filePath,
			args,
			{ timeout: 10_000, windowsHide: true },
			(error, stdout, stderr) => {
				resolve({
					ok: error === null,
					stdout: String(stdout).trim(),
					stderr: String(stderr).trim(),
				});
			},
		);
	});
}

async function executeProbeCommand(
	runner: CodexCommandRunner,
	filePath: string,
	args: string[],
): Promise<CommandResult> {
	try {
		return await runner(filePath, args);
	} catch (error) {
		return {
			ok: false,
			stdout: "",
			stderr:
				error instanceof Error
					? error.message
					: "The command could not be executed.",
		};
	}
}

function extractVersion(output: string): string | undefined {
	return output.match(/\b\d+\.\d+\.\d+(?:[-+][\w.-]+)?\b/)?.[0];
}

export async function probeOfficialCodexCli(
	options: RuntimeResolverOptions,
	runner: CodexCommandRunner = runCommand,
): Promise<AgentEngineDescriptor> {
	const runtime = resolveCodexRuntime(options);
	if (!runtime) {
		return {
			id: "codex",
			label: "Official Codex CLI",
			availability: "unavailable",
			enabled: false,
			capabilities: CODEX_CAPABILITIES_DISABLED,
			reason:
				"The official Codex CLI is not included in this release. Use OpenAI Codex through OpenCode.",
		};
	}

	const versionResult = await executeProbeCommand(runner, runtime.path, [
		"--version",
	]);
	if (!versionResult.ok) {
		return {
			id: "codex",
			label: "Official Codex CLI",
			availability: "incompatible",
			enabled: false,
			capabilities: CODEX_CAPABILITIES_DISABLED,
			source: runtime.source,
			reason: "The detected Codex CLI could not be executed.",
		};
	}

	const appServerResult = await executeProbeCommand(runner, runtime.path, [
		"app-server",
		"--help",
	]);
	if (!appServerResult.ok) {
		return {
			id: "codex",
			label: "Official Codex CLI",
			availability: "incompatible",
			enabled: false,
			capabilities: CODEX_CAPABILITIES_DISABLED,
			source: runtime.source,
			version: extractVersion(versionResult.stdout),
			reason:
				"The detected Codex CLI does not expose the required app-server interface.",
		};
	}

	return {
		id: "codex",
		label: "Official Codex CLI",
		availability: "available",
		enabled: false,
		capabilities: CODEX_CAPABILITIES_DISABLED,
		source: runtime.source,
		version: extractVersion(versionResult.stdout),
		transport: "app-server",
		reason:
			"Detected for compatibility testing; the official engine is not enabled yet.",
	};
}
