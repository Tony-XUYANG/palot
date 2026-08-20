/**
 * Disabled preview adapter for the official Codex app-server.
 */

import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
	AgentEngine,
	AgentEngineConnection,
	AgentEngineDescriptor,
	AgentEngineEvent,
	AgentEngineLoginResult,
	AgentEngineModel,
	AgentEnginePromptRequest,
	AgentFileDiff,
	AgentPromptPart,
	AgentSession,
} from "./agent-engine";
import type {
	CodexAccountReadResponse,
	CodexInitializeParams,
	CodexInitializeResponse,
	CodexLoginResponse,
	CodexModelListResponse,
	CodexThreadStartResponse,
	CodexTurnDiffUpdatedNotification,
	CodexTurnStartResponse,
	CodexUserInput,
} from "./codex-app-server-protocol";
import {
	AsyncEventQueue,
	CodexJsonRpcClient,
	type CodexJsonRpcNotification,
} from "./codex-json-rpc";

export interface CodexAgentEngineDependencies {
	runtimePath: string;
	codexHome: string;
	inspect: () => Promise<AgentEngineDescriptor>;
	spawnProcess?: typeof spawn;
	requestTimeoutMs?: number;
	environment?: NodeJS.ProcessEnv;
}

export interface CodexAgentEngine extends AgentEngine {
	beginLogin(): Promise<AgentEngineLoginResult>;
	listModels(): Promise<AgentEngineModel[]>;
}

function mapSession(
	thread: CodexThreadStartResponse["thread"],
	fallbackTitle?: string,
): AgentSession {
	return {
		id: thread.id,
		title: thread.name ?? fallbackTitle ?? "Codex session",
		directory: thread.cwd,
		createdAt: thread.createdAt * 1_000,
		updatedAt: thread.updatedAt * 1_000,
	};
}

function mapPromptPart(part: AgentPromptPart): CodexUserInput {
	if (part.type === "text")
		return { type: "text", text: part.text, text_elements: [] };
	if (!part.mime.startsWith("image/")) {
		throw new Error(
			"The official Codex preview currently accepts only text and image prompt parts",
		);
	}
	if (part.url.startsWith("file:")) {
		return { type: "localImage", path: fileURLToPath(part.url), detail: null };
	}
	return { type: "image", url: part.url, detail: null };
}

function countPatchLines(patch: string, prefix: "+" | "-"): number {
	const metadata = prefix.repeat(3);
	return patch
		.split(/\r?\n/)
		.filter((line) => line.startsWith(prefix) && !line.startsWith(metadata))
		.length;
}

export function parseCodexUnifiedDiff(diff: string): AgentFileDiff[] {
	if (!diff.trim()) return [];
	const headers = [...diff.matchAll(/^diff --git a\/(.+) b\/(.+)$/gm)];
	if (headers.length === 0) {
		return [
			{
				file: "Working tree",
				before: "",
				after: "",
				additions: countPatchLines(diff, "+"),
				deletions: countPatchLines(diff, "-"),
				status: "modified",
				patch: diff,
			},
		];
	}
	return headers.map((header, index) => {
		const start = header.index ?? 0;
		const end = headers[index + 1]?.index ?? diff.length;
		const patch = diff.slice(start, end).trimEnd();
		const status = patch.includes("\nnew file mode ")
			? "added"
			: patch.includes("\ndeleted file mode ")
				? "deleted"
				: "modified";
		return {
			file: status === "deleted" ? header[1] : header[2],
			before: "",
			after: "",
			additions: countPatchLines(patch, "+"),
			deletions: countPatchLines(patch, "-"),
			status,
			patch,
		};
	});
}

export function createCodexAgentEngine(
	dependencies: CodexAgentEngineDependencies,
): CodexAgentEngine {
	if (!path.isAbsolute(dependencies.runtimePath)) {
		throw new Error("The Codex runtime path must be absolute");
	}
	if (!path.isAbsolute(dependencies.codexHome)) {
		throw new Error("CODEX_HOME must be an absolute path");
	}
	let process: ChildProcessWithoutNullStreams | null = null;
	let rpc: CodexJsonRpcClient | null = null;
	let eventQueue = new AsyncEventQueue<AgentEngineEvent>();
	const sessionDirectories = new Map<string, string>();
	const activeTurns = new Map<string, string>();
	const latestDiffs = new Map<string, string>();

	function handleNotification(notification: CodexJsonRpcNotification): void {
		const params = notification.params;
		let sessionID: string | undefined;
		if (params && typeof params === "object" && "threadId" in params) {
			sessionID = String(params.threadId);
		}
		if (notification.method === "turn/diff/updated" && sessionID) {
			const diff = params as CodexTurnDiffUpdatedNotification;
			latestDiffs.set(sessionID, diff.diff);
			activeTurns.set(sessionID, diff.turnId);
		}
		if (notification.method === "turn/completed" && sessionID) {
			activeTurns.delete(sessionID);
		}
		eventQueue.push({
			type: notification.method,
			payload: params,
			directory: sessionID ? sessionDirectories.get(sessionID) : undefined,
			sessionID,
		});
	}

	async function getRpc(): Promise<CodexJsonRpcClient> {
		if (rpc) return rpc;
		await mkdir(dependencies.codexHome, { recursive: true });
		eventQueue = new AsyncEventQueue<AgentEngineEvent>();
		const spawnProcess = dependencies.spawnProcess ?? spawn;
		process = spawnProcess(
			dependencies.runtimePath,
			["app-server", "--listen", "stdio://", "--strict-config"],
			{
				env: {
					...(dependencies.environment ?? globalThis.process.env),
					CODEX_HOME: dependencies.codexHome,
				},
				stdio: "pipe",
				windowsHide: true,
			},
		);
		process.stderr.resume();
		const client = new CodexJsonRpcClient({
			process,
			requestTimeoutMs: dependencies.requestTimeoutMs,
			onNotification: handleNotification,
			onClose: () => {
				rpc = null;
				process = null;
				activeTurns.clear();
				eventQueue.close();
			},
		});
		rpc = client;
		const initialize: CodexInitializeParams = {
			clientInfo: { name: "palot", title: "Palot", version: "0.13.0-beta.0" },
			capabilities: null,
		};
		try {
			await client.request<CodexInitializeResponse>("initialize", initialize);
			return client;
		} catch (error) {
			const failedProcess = process;
			client.dispose(
				error instanceof Error
					? error
					: new Error("Codex initialization failed"),
			);
			failedProcess?.kill();
			throw error;
		}
	}

	return {
		id: "codex",
		inspect: dependencies.inspect,
		async start(): Promise<AgentEngineConnection> {
			await getRpc();
			return { engine: "codex", transport: "app-server", endpoint: "stdio://" };
		},
		async stop(): Promise<boolean> {
			if (!process) return false;
			const currentProcess = process;
			rpc?.dispose();
			currentProcess.kill();
			return true;
		},
		async authStatus() {
			const client = await getRpc();
			const result = await client.request<CodexAccountReadResponse>(
				"account/read",
				{
					refreshToken: false,
				},
			);
			return {
				state: result.account ? "connected" : "disconnected",
				providerIDs: result.account ? ["openai"] : [],
			};
		},
		async beginLogin(): Promise<AgentEngineLoginResult> {
			const client = await getRpc();
			const result = await client.request<CodexLoginResponse>(
				"account/login/start",
				{
					type: "chatgpt",
					appBrand: "codex",
					codexStreamlinedLogin: true,
					useHostedLoginSuccessPage: true,
				},
			);
			if (result.type !== "chatgpt" || !result.authUrl) {
				throw new Error("Codex did not return a browser login URL");
			}
			return { type: "browser", url: result.authUrl, loginID: result.loginId };
		},
		async listModels(): Promise<AgentEngineModel[]> {
			const client = await getRpc();
			const models: AgentEngineModel[] = [];
			let cursor: string | null = null;
			do {
				const result: CodexModelListResponse =
					await client.request<CodexModelListResponse>("model/list", {
						cursor,
						includeHidden: false,
					});
				models.push(
					...result.data.map((model) => ({
						id: model.model || model.id,
						label: model.displayName,
						description: model.description,
						isDefault: model.isDefault,
						hidden: model.hidden,
					})),
				);
				cursor = result.nextCursor ?? null;
			} while (cursor);
			return models;
		},
		async createSession(
			directory: string,
			title?: string,
		): Promise<AgentSession> {
			const client = await getRpc();
			const result = await client.request<CodexThreadStartResponse>(
				"thread/start",
				{
					cwd: directory,
					approvalPolicy: "never",
					sandbox: "workspace-write",
				},
			);
			sessionDirectories.set(result.thread.id, directory);
			return mapSession(result.thread, title);
		},
		async prompt(request: AgentEnginePromptRequest): Promise<void> {
			const client = await getRpc();
			const result = await client.request<CodexTurnStartResponse>(
				"turn/start",
				{
					threadId: request.sessionID,
					cwd: request.directory,
					model: request.model.modelID,
					approvalPolicy: "never",
					input: request.parts.map(mapPromptPart),
				},
			);
			sessionDirectories.set(request.sessionID, request.directory);
			activeTurns.set(request.sessionID, result.turn.id);
		},
		async events(): Promise<AsyncIterable<AgentEngineEvent>> {
			await getRpc();
			return eventQueue;
		},
		async cancel(_directory: string, sessionID: string): Promise<void> {
			const turnID = activeTurns.get(sessionID);
			if (!turnID)
				throw new Error("The Codex session has no active turn to cancel");
			const client = await getRpc();
			await client.request("turn/interrupt", {
				threadId: sessionID,
				turnId: turnID,
			});
			activeTurns.delete(sessionID);
		},
		async diff(
			_directory: string,
			sessionID: string,
		): Promise<AgentFileDiff[]> {
			return parseCodexUnifiedDiff(latestDiffs.get(sessionID) ?? "");
		},
	};
}
