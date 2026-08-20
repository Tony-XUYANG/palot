import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { PassThrough } from "node:stream";
import { describe, it } from "node:test";
import {
	CodexJsonRpcClient,
	type CodexJsonRpcProcess,
} from "./codex-json-rpc.ts";

function createProcess(): {
	process: CodexJsonRpcProcess;
	stdin: PassThrough;
	stdout: PassThrough;
	emitter: EventEmitter;
} {
	const stdin = new PassThrough();
	const stdout = new PassThrough();
	const emitter = new EventEmitter();
	const process = Object.assign(emitter, {
		stdin,
		stdout,
	}) as CodexJsonRpcProcess;
	return { process, stdin, stdout, emitter };
}

async function readRequest(
	stdin: PassThrough,
): Promise<Record<string, unknown>> {
	const [chunk] = await once(stdin, "data");
	return JSON.parse(String(chunk).trim()) as Record<string, unknown>;
}

describe("Codex newline JSON-RPC transport", () => {
	it("frames partial lines and correlates concurrent responses", async () => {
		const transport = createProcess();
		const client = new CodexJsonRpcClient({ process: transport.process });
		const first = client.request<{ value: string }>("first", { n: 1 });
		const firstRequest = await readRequest(transport.stdin);
		const second = client.request<{ value: string }>("second", { n: 2 });
		const secondRequest = await readRequest(transport.stdin);
		const firstResponse = JSON.stringify({
			id: firstRequest.id,
			result: { value: "one" },
		});

		transport.stdout.write(
			`${JSON.stringify({ id: secondRequest.id, result: { value: "two" } })}\n${firstResponse.slice(0, 12)}`,
		);
		transport.stdout.write(`${firstResponse.slice(12)}\n`);

		assert.deepEqual(await second, { value: "two" });
		assert.deepEqual(await first, { value: "one" });
		assert.equal(client.pendingRequestCount, 0);
	});

	it("removes timed-out and exited requests", async () => {
		const timeoutTransport = createProcess();
		const timeoutClient = new CodexJsonRpcClient({
			process: timeoutTransport.process,
			requestTimeoutMs: 5,
		});
		await assert.rejects(timeoutClient.request("slow"), /timed out/);
		assert.equal(timeoutClient.pendingRequestCount, 0);

		const exitTransport = createProcess();
		const exitClient = new CodexJsonRpcClient({
			process: exitTransport.process,
		});
		const pending = exitClient.request("pending");
		exitTransport.emitter.emit("exit", 17, null);
		await assert.rejects(pending, /exit code 17/);
		assert.equal(exitClient.pendingRequestCount, 0);
	});

	it("isolates malformed lines and streams notifications", async () => {
		const transport = createProcess();
		const malformed: string[] = [];
		const client = new CodexJsonRpcClient({
			process: transport.process,
			onMalformedMessage: (line) => malformed.push(line),
		});
		const iterator = client.notifications()[Symbol.asyncIterator]();
		transport.stdout.write(
			'not-json\n{"method":"turn/diff/updated","params":{"diff":"x"}}\n',
		);

		assert.deepEqual(malformed, ["not-json"]);
		assert.deepEqual(await iterator.next(), {
			value: { method: "turn/diff/updated", params: { diff: "x" } },
			done: false,
		});
	});
});
