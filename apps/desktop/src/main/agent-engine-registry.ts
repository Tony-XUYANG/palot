/**
 * Registers the active OpenCode engine and probes future engine runtimes.
 */

import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import { app } from "electron"
import type { AgentEngine, AgentEngineDescriptor } from "./agent-engine"
import { probeOfficialCodexCli } from "./codex-cli-probe"
import { createOpenCodeAgentEngine } from "./opencode-agent-engine"
import { ensureServer, getServerUrl, stopServer } from "./opencode-manager"
import {
	OPENCODE_RUNTIME_VERSION,
	resolveOpenCodeRuntime,
	type RuntimeResolverOptions,
} from "./runtime-resolver"

const OPENCODE_CAPABILITIES = {
	auth: true,
	sessions: true,
	prompts: true,
	events: true,
	cancel: true,
	diff: true,
} as const

function getRuntimeOptions(): RuntimeResolverOptions {
	return {
		isPackaged: app.isPackaged,
		resourcesPath: process.resourcesPath,
	}
}

const openCodeEngine = createOpenCodeAgentEngine({
	async inspect(): Promise<AgentEngineDescriptor> {
		const runtime = resolveOpenCodeRuntime(getRuntimeOptions())
		if (!runtime) {
			return {
				id: "opencode",
				label: "OpenCode",
				availability: "unavailable",
				enabled: true,
				capabilities: OPENCODE_CAPABILITIES,
				reason: app.isPackaged
					? "The included OpenCode runtime is missing. Reinstall Palot."
					: "OpenCode was not found in the development environment.",
			}
		}
		return {
			id: "opencode",
			label: "OpenCode",
			availability: "available",
			enabled: true,
			capabilities: OPENCODE_CAPABILITIES,
			source: runtime.source,
			version: OPENCODE_RUNTIME_VERSION,
			transport: "http",
		}
	},
	ensureServer,
	getServerUrl,
	stopServer,
	createClient: (baseUrl, directory) => createOpencodeClient({ baseUrl, directory }),
})

export function getOpenCodeAgentEngine(): AgentEngine {
	return openCodeEngine
}

export async function listAgentEngineDescriptors(): Promise<AgentEngineDescriptor[]> {
	const [openCode, codex] = await Promise.all([
		openCodeEngine.inspect(),
		probeOfficialCodexCli(getRuntimeOptions()),
	])
	return [openCode, codex]
}
