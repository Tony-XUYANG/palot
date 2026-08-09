/**
 * Loopback-only OpenAI-compatible proxy that keeps the cloud token in the main process.
 */

import { randomBytes, randomUUID } from "node:crypto"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { Readable } from "node:stream"

const MAX_REQUEST_BYTES = 5 * 1024 * 1024
const ALLOWED_ROUTES = new Map([
	["GET /v1/models", true],
	["GET /v1/account", true],
	["POST /v1/chat/completions", true],
])

export type PalotCloudProxyFetch = (
	input: string | Request,
	init?: RequestInit,
) => Promise<Response>

export interface PalotCloudProxy {
	baseUrl: string
	sessionToken: string
	close(): Promise<void>
}

export interface PalotCloudProxyOptions {
	gatewayUrl: string
	cloudToken: string
	fetch: PalotCloudProxyFetch
}

async function readRequestBody(request: IncomingMessage): Promise<Buffer | null> {
	if (request.method === "GET" || request.method === "HEAD") return null
	const chunks: Buffer[] = []
	let length = 0
	for await (const chunk of request) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
		length += buffer.length
		if (length > MAX_REQUEST_BYTES) throw new Error("REQUEST_TOO_LARGE")
		chunks.push(buffer)
	}
	return Buffer.concat(chunks)
}

function writeJsonError(response: ServerResponse, status: number, code: string, message: string): void {
	response.writeHead(status, { "content-type": "application/json" })
	response.end(JSON.stringify({ error: { code, message, type: "palot_cloud_proxy_error" } }))
}

function copyAllowedResponseHeaders(source: Headers, response: ServerResponse): void {
	for (const name of ["content-type", "cache-control", "x-request-id"]) {
		const value = source.get(name)
		if (value) response.setHeader(name, value)
	}
}

async function closeServer(server: Server): Promise<void> {
	if (!server.listening) return
	await new Promise<void>((resolve, reject) => {
		server.close((error) => (error ? reject(error) : resolve()))
	})
}

export async function startPalotCloudProxy(
	options: PalotCloudProxyOptions,
): Promise<PalotCloudProxy> {
	const sessionToken = randomBytes(32).toString("base64url")
	let port = 0
	const server = createServer(async (request, response) => {
		const remoteAddress = request.socket.remoteAddress
		if (remoteAddress !== "127.0.0.1" && remoteAddress !== "::1") {
			writeJsonError(response, 403, "loopback_required", "Loopback access is required")
			return
		}
		const host = request.headers.host
		if (host !== `127.0.0.1:${port}`) {
			writeJsonError(response, 403, "invalid_host", "Invalid loopback host")
			return
		}
		if (request.headers.authorization !== `Bearer ${sessionToken}`) {
			writeJsonError(response, 401, "invalid_session", "Invalid local session token")
			return
		}
		const parsedUrl = new URL(request.url ?? "/", `http://${host}`)
		const routeKey = `${request.method ?? "GET"} ${parsedUrl.pathname}`
		if (!ALLOWED_ROUTES.has(routeKey) || parsedUrl.search) {
			writeJsonError(response, 404, "route_not_found", "Palot Cloud proxy route not found")
			return
		}

		const abortController = new AbortController()
		request.on("aborted", () => abortController.abort())
		response.on("close", () => {
			if (!response.writableEnded) abortController.abort()
		})
		try {
			const body = await readRequestBody(request)
			const headers = new Headers({ authorization: `Bearer ${options.cloudToken}` })
			const contentType = request.headers["content-type"]
			if (typeof contentType === "string") headers.set("content-type", contentType)
			if (request.method === "POST") {
				headers.set(
					"idempotency-key",
					typeof request.headers["idempotency-key"] === "string"
						? request.headers["idempotency-key"]
						: randomUUID(),
				)
			}
			const upstream = await options.fetch(`${options.gatewayUrl}${parsedUrl.pathname}`, {
				method: request.method,
				headers,
				body: body?.toString("utf8"),
				signal: abortController.signal,
			})
			response.statusCode = upstream.status
			response.statusMessage = upstream.statusText
			copyAllowedResponseHeaders(upstream.headers, response)
			if (!upstream.body) {
				response.end()
				return
			}
			Readable.fromWeb(upstream.body as unknown as Parameters<typeof Readable.fromWeb>[0])
				.on("error", () => response.destroy())
				.pipe(response)
		} catch (error) {
			if (response.headersSent) {
				response.destroy()
				return
			}
			if (error instanceof Error && error.message === "REQUEST_TOO_LARGE") {
				writeJsonError(response, 413, "request_too_large", "Request body exceeds 5 MiB")
				return
			}
			writeJsonError(response, 502, "gateway_unavailable", "Palot Cloud is unavailable")
		}
	})

	await new Promise<void>((resolve, reject) => {
		server.once("error", reject)
		server.listen(0, "127.0.0.1", () => {
			server.off("error", reject)
			resolve()
		})
	})
	const address = server.address()
	if (!address || typeof address === "string") {
		await closeServer(server)
		throw new Error("Palot Cloud proxy did not bind to a TCP port")
	}
	port = address.port
	return {
		baseUrl: `http://127.0.0.1:${port}/v1`,
		sessionToken,
		close: async () => await closeServer(server),
	}
}
