/**
 * OpenCode implementation of the shared agent engine contract.
 */

import type {
	FileDiff,
	GlobalEvent,
	OpencodeClient,
	ProviderListResponse,
	Session,
	TextPartInput,
	FilePartInput,
} from "@opencode-ai/sdk/v2/client"
import type {
	AgentEngine,
	AgentEngineConnection,
	AgentEngineDescriptor,
	AgentEngineEvent,
	AgentEnginePromptRequest,
	AgentFileDiff,
	AgentSession,
} from "./agent-engine"

export interface OpenCodeAgentEngineDependencies {
	inspect: () => Promise<AgentEngineDescriptor>
	ensureServer: () => Promise<{ url: string }>
	getServerUrl: () => string | null
	stopServer: () => boolean
	createClient: (baseUrl: string, directory?: string) => OpencodeClient
}

function mapSession(session: Session): AgentSession {
	return {
		id: session.id,
		title: session.title,
		directory: session.directory,
		createdAt: session.time.created,
		updatedAt: session.time.updated,
		...(session.parentID ? { parentID: session.parentID } : {}),
	}
}

function mapDiff(diff: FileDiff): AgentFileDiff {
	return {
		file: diff.file,
		before: diff.before,
		after: diff.after,
		additions: diff.additions,
		deletions: diff.deletions,
		status: diff.status,
	}
}

async function* mapEvents(stream: AsyncIterable<GlobalEvent>): AsyncIterable<AgentEngineEvent> {
	for await (const event of stream) {
		const payload = event.payload
		const properties = "properties" in payload ? payload.properties : undefined
		const sessionID =
			properties && typeof properties === "object" && "sessionID" in properties
				? String(properties.sessionID)
				: undefined
		yield {
			type: payload.type,
			payload,
			directory: event.directory,
			sessionID,
		}
	}
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
		async createSession(directory: string, title?: string): Promise<AgentSession> {
			const client = await getClient(directory)
			const result = await client.session.create({ title })
			return mapSession(result.data as Session)
		},
		async prompt(request: AgentEnginePromptRequest): Promise<void> {
			const client = await getClient(request.directory)
			await client.session.promptAsync({
				sessionID: request.sessionID,
				parts: request.parts as Array<TextPartInput | FilePartInput>,
				model: request.model,
				agent: request.agent,
				variant: request.variant,
			})
		},
		async events(): Promise<AsyncIterable<AgentEngineEvent>> {
			const client = await getClient()
			const result = await client.global.event()
			return mapEvents(result.stream as AsyncIterable<GlobalEvent>)
		},
		async cancel(directory: string, sessionID: string): Promise<void> {
			const client = await getClient(directory)
			await client.session.abort({ sessionID })
		},
		async diff(directory: string, sessionID: string): Promise<AgentFileDiff[]> {
			const client = await getClient(directory)
			const result = await client.session.diff({ sessionID })
			return ((result.data as FileDiff[] | undefined) ?? []).map(mapDiff)
		},
	}
}
