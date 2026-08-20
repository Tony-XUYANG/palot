/**
 * Newline-delimited JSON-RPC transport used by the experimental Codex app-server preview.
 */

import type { Readable, Writable } from "node:stream";

export interface CodexJsonRpcProcess {
	stdin: Writable;
	stdout: Readable;
	on(
		event: "exit",
		listener: (code: number | null, signal: NodeJS.Signals | null) => void,
	): this;
	on(event: "error", listener: (error: Error) => void): this;
}

export interface CodexJsonRpcNotification {
	method: string;
	params?: unknown;
}

interface PendingRequest {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
}

interface JsonRpcResponse {
	id: number;
	result?: unknown;
	error?: {
		code?: number;
		message?: string;
		data?: unknown;
	};
}

export class AsyncEventQueue<T> implements AsyncIterable<T>, AsyncIterator<T> {
	private readonly values: T[] = [];
	private readonly waiters: Array<(result: IteratorResult<T>) => void> = [];
	private closed = false;

	push(value: T): void {
		if (this.closed) return;
		const waiter = this.waiters.shift();
		if (waiter) {
			waiter({ value, done: false });
			return;
		}
		this.values.push(value);
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		for (const waiter of this.waiters.splice(0)) {
			waiter({ value: undefined, done: true });
		}
	}

	[Symbol.asyncIterator](): AsyncIterator<T> {
		return this;
	}

	async next(): Promise<IteratorResult<T>> {
		const value = this.values.shift();
		if (value !== undefined) return { value, done: false };
		if (this.closed) return { value: undefined, done: true };
		return await new Promise((resolve) => this.waiters.push(resolve));
	}
}

export interface CodexJsonRpcClientOptions {
	process: CodexJsonRpcProcess;
	requestTimeoutMs?: number;
	onMalformedMessage?: (line: string, error: Error) => void;
	onNotification?: (notification: CodexJsonRpcNotification) => void;
	onClose?: (error: Error) => void;
}

export class CodexJsonRpcClient {
	private readonly process: CodexJsonRpcProcess;
	private readonly requestTimeoutMs: number;
	private readonly onMalformedMessage?: (line: string, error: Error) => void;
	private readonly onNotification?: (
		notification: CodexJsonRpcNotification,
	) => void;
	private readonly onClose?: (error: Error) => void;
	private readonly notificationQueue =
		new AsyncEventQueue<CodexJsonRpcNotification>();
	private readonly pending = new Map<number, PendingRequest>();
	private nextRequestID = 1;
	private stdoutBuffer = "";
	private closed = false;

	constructor(options: CodexJsonRpcClientOptions) {
		this.process = options.process;
		this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
		this.onMalformedMessage = options.onMalformedMessage;
		this.onNotification = options.onNotification;
		this.onClose = options.onClose;
		this.process.stdout.setEncoding("utf8");
		this.process.stdout.on("data", (chunk: string) => this.handleChunk(chunk));
		this.process.on("exit", (code, signal) => {
			const detail = signal
				? `signal ${signal}`
				: `exit code ${code ?? "unknown"}`;
			this.close(new Error(`Codex app-server exited with ${detail}`));
		});
		this.process.on("error", (error) => this.close(error));
	}

	get pendingRequestCount(): number {
		return this.pending.size;
	}

	async request<Result>(method: string, params?: unknown): Promise<Result> {
		if (this.closed) throw new Error("Codex JSON-RPC transport is closed");
		const id = this.nextRequestID++;
		return await new Promise<Result>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`Codex JSON-RPC request timed out: ${method}`));
			}, this.requestTimeoutMs);
			this.pending.set(id, {
				resolve: (value) => resolve(value as Result),
				reject,
				timer,
			});
			this.process.stdin.write(
				`${JSON.stringify({ id, method, params })}\n`,
				(error) => {
					if (error) this.rejectRequest(id, error);
				},
			);
		});
	}

	notify(method: string, params?: unknown): void {
		if (this.closed) throw new Error("Codex JSON-RPC transport is closed");
		this.process.stdin.write(`${JSON.stringify({ method, params })}\n`);
	}

	notifications(): AsyncIterable<CodexJsonRpcNotification> {
		return this.notificationQueue;
	}

	dispose(reason = new Error("Codex JSON-RPC transport was disposed")): void {
		this.close(reason);
	}

	private handleChunk(chunk: string): void {
		this.stdoutBuffer += chunk;
		for (;;) {
			const newline = this.stdoutBuffer.indexOf("\n");
			if (newline < 0) return;
			const line = this.stdoutBuffer.slice(0, newline).replace(/\r$/, "");
			this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
			if (line.trim()) this.handleLine(line);
		}
	}

	private handleLine(line: string): void {
		let message: unknown;
		try {
			message = JSON.parse(line);
		} catch (error) {
			this.onMalformedMessage?.(
				line,
				error instanceof Error ? error : new Error("Invalid JSON-RPC message"),
			);
			return;
		}
		if (!message || typeof message !== "object") return;
		if ("id" in message && typeof message.id === "number") {
			this.handleResponse(message as JsonRpcResponse);
			return;
		}
		if ("method" in message && typeof message.method === "string") {
			const notification = message as CodexJsonRpcNotification;
			this.onNotification?.(notification);
			this.notificationQueue.push(notification);
		}
	}

	private handleResponse(response: JsonRpcResponse): void {
		const request = this.pending.get(response.id);
		if (!request) return;
		this.pending.delete(response.id);
		clearTimeout(request.timer);
		if (response.error) {
			request.reject(
				new Error(
					response.error.message ??
						`Codex JSON-RPC error ${response.error.code ?? "unknown"}`,
				),
			);
			return;
		}
		request.resolve(response.result);
	}

	private rejectRequest(id: number, error: Error): void {
		const request = this.pending.get(id);
		if (!request) return;
		this.pending.delete(id);
		clearTimeout(request.timer);
		request.reject(error);
	}

	private close(error: Error): void {
		if (this.closed) return;
		this.closed = true;
		for (const [id, request] of this.pending) {
			this.pending.delete(id);
			clearTimeout(request.timer);
			request.reject(error);
		}
		this.notificationQueue.close();
		this.onClose?.(error);
	}
}
