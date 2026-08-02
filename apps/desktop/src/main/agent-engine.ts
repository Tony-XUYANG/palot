/**
 * Shared contract for agent runtimes hosted by the Electron main process.
 */

import type {
	FileDiff,
	FilePartInput,
	GlobalEvent,
	Session,
	TextPartInput,
} from "@opencode-ai/sdk/v2/client"
import type { RuntimeSource } from "./runtime-resolver"

export type AgentEngineId = "opencode" | "codex"
export type AgentEngineAvailability = "available" | "unavailable" | "incompatible"
export type AgentEngineTransport = "http" | "app-server"

export interface AgentEngineCapabilities {
	auth: boolean
	sessions: boolean
	prompts: boolean
	events: boolean
	cancel: boolean
	diff: boolean
}

export interface AgentEngineDescriptor {
	id: AgentEngineId
	label: string
	availability: AgentEngineAvailability
	enabled: boolean
	capabilities: AgentEngineCapabilities
	source?: RuntimeSource
	version?: string
	transport?: AgentEngineTransport
	reason?: string
}

export interface AgentEngineConnection {
	engine: AgentEngineId
	transport: AgentEngineTransport
	endpoint?: string
}

export interface AgentEngineAuthStatus {
	state: "connected" | "disconnected" | "unknown"
	providerIDs: string[]
}

export interface AgentEnginePromptRequest {
	directory: string
	sessionID: string
	parts: Array<TextPartInput | FilePartInput>
	model: {
		providerID: string
		modelID: string
	}
	agent?: string
	variant?: string
}

export interface AgentEngine {
	readonly id: AgentEngineId
	inspect(): Promise<AgentEngineDescriptor>
	start(): Promise<AgentEngineConnection>
	stop(): Promise<boolean>
	authStatus(directory?: string): Promise<AgentEngineAuthStatus>
	createSession(directory: string, title?: string): Promise<Session>
	prompt(request: AgentEnginePromptRequest): Promise<void>
	events(): Promise<AsyncIterable<GlobalEvent>>
	cancel(directory: string, sessionID: string): Promise<void>
	diff(directory: string, sessionID: string): Promise<FileDiff[]>
}
