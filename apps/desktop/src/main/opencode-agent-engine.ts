/**
 * OpenCode implementation of the shared agent engine contract.
 */

import type {
	FileDiff,
	GlobalEvent,
	OpencodeClient,
	ProviderListResponse,
	Session,
} from "@opencode-ai/sdk/v2/client"
import type {
	AgentEngine,
	AgentEngineConnection,
	AgentEngineDescriptor,
	AgentEnginePromptRequest,
} from "./agent-engine"

export interface OpenCodeAgentEngineDependencies {
	inspect: () => Promise<AgentEngineDescriptor>
	ensureServer: () => Promise<{ url: string }>
	getServerUrl: () => string | null
	stopServer: () => boolean
	createClient: (baseUrl: string, directory?: string) => OpencodeClient
}

export function createOpenCodeAgentEngine(
	dependencies: OpenCodeAgentEngineDependencies,
): AgentEngine {
	async function getClient(directory?: string): Promise<OpencodeClient> {
		const currentUrl = dependencies.getServerUrl()
		const url = currentUrl ?? (await dependencies.ensureServer()).url
		return dependencies.createClient(url, directory)
	}

	return {
		id: "opencode",
		inspect: dependencies.inspect,
		async start(): Promise<AgentEngineConnection> {
			const server = await dependencies.ensureServer()
			return { engine: "opencode", transport: "http", endpoint: server.url }
		},
		async stop(): Promise<boolean> {
			return dependencies.stopServer()
		},
		async authStatus(directory) {
			const client = await getClient(directory)
			const result = await client.provider.list()
			const data = result.data as ProviderListResponse | undefined
			const providerIDs = data?.connected ?? []
			return {
				state: providerIDs.length > 0 ? "connected" : "disconnected",
				providerIDs,
			}
		},
		async createSession(directory: string, title?: string): Promise<Session> {
			const client = await getClient(directory)
			const result = await client.session.create({ title })
			return result.data as Session
		},
		async prompt(request: AgentEnginePromptRequest): Promise<void> {
			const client = await getClient(request.directory)
			await client.session.promptAsync({
				sessionID: request.sessionID,
				parts: request.parts,
				model: request.model,
				agent: request.agent,
				variant: request.variant,
			})
		},
		async events(): Promise<AsyncIterable<GlobalEvent>> {
			const client = await getClient()
			const result = await client.global.event()
			return result.stream as AsyncIterable<GlobalEvent>
		},
		async cancel(directory: string, sessionID: string): Promise<void> {
			const client = await getClient(directory)
			await client.session.abort({ sessionID })
		},
		async diff(directory: string, sessionID: string): Promise<FileDiff[]> {
			const client = await getClient(directory)
			const result = await client.session.diff({ sessionID })
			return (result.data as FileDiff[] | undefined) ?? []
		},
	}
}
