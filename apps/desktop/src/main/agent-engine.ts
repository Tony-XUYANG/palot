/**
 * Engine-neutral contract for agent runtimes hosted by the Electron main process.
 */

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

export interface AgentSession {
	id: string
	title: string
	directory: string
	createdAt: number
	updatedAt: number
	parentID?: string
}

export interface AgentTextPromptPart {
	type: "text"
	text: string
}

export interface AgentFilePromptPart {
	type: "file"
	url: string
	mime: string
	filename?: string
}

export type AgentPromptPart = AgentTextPromptPart | AgentFilePromptPart

export interface AgentEngineEvent {
	type: string
	payload: unknown
	directory?: string
	sessionID?: string
}

export interface AgentFileDiff {
	file: string
	before: string
	after: string
	additions: number
	deletions: number
	status?: "added" | "deleted" | "modified"
	patch?: string
}

export interface AgentEngineModel {
	id: string
	label: string
	description?: string
	isDefault: boolean
	hidden: boolean
}

export interface AgentEngineLoginResult {
	type: "browser"
	url: string
	loginID: string
}

export interface AgentEnginePromptRequest {
	directory: string
	sessionID: string
	parts: AgentPromptPart[]
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
	createSession(directory: string, title?: string): Promise<AgentSession>
	prompt(request: AgentEnginePromptRequest): Promise<void>
	events(): Promise<AsyncIterable<AgentEngineEvent>>
	cancel(directory: string, sessionID: string): Promise<void>
	diff(directory: string, sessionID: string): Promise<AgentFileDiff[]>
	beginLogin?(): Promise<AgentEngineLoginResult>
	listModels?(): Promise<AgentEngineModel[]>
}
