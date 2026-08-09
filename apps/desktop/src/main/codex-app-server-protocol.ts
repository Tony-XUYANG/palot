/**
 * Audited subset of Codex 0.146.0 app-server v2 generated protocol types.
 * Regenerate from the pinned preview manifest before upgrading the CLI.
 */

export interface CodexInitializeParams {
	clientInfo: {
		name: string
		title: string
		version: string
	}
	capabilities: null
}

export interface CodexInitializeResponse {
	codexHome: string
	platformFamily: string
	platformOs: string
	userAgent: string
}

export interface CodexAccountReadResponse {
	account: null | {
		type: "apiKey" | "chatgpt" | "amazonBedrock"
		email?: string | null
		planType?: string
	}
	requiresOpenaiAuth: boolean
}

export interface CodexLoginResponse {
	type: "chatgpt"
	authUrl: string
	loginId: string
}

export interface CodexModelListResponse {
	data: Array<{
		id: string
		model: string
		displayName: string
		description: string
		hidden: boolean
		isDefault: boolean
	}>
	nextCursor?: string | null
}

export interface CodexThread {
	id: string
	cwd: string
	createdAt: number
	updatedAt: number
	name?: string | null
}

export interface CodexThreadStartResponse {
	thread: CodexThread
}

export type CodexUserInput =
	| { type: "text"; text: string; text_elements: [] }
	| { type: "image"; url: string; detail: null }
	| { type: "localImage"; path: string; detail: null }

export interface CodexTurnStartResponse {
	turn: {
		id: string
		status: "completed" | "interrupted" | "failed" | "inProgress"
	}
}

export interface CodexTurnDiffUpdatedNotification {
	threadId: string
	turnId: string
	diff: string
}
