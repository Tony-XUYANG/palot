/**
 * Drives Palot's preload updater API over a loopback Chrome DevTools Protocol connection.
 */

function parseArguments(args) {
	const values = {}
	for (let index = 0; index < args.length; index += 2) {
		const flag = args[index]
		const value = args[index + 1]
		if (!flag?.startsWith("--") || value === undefined) {
			throw new Error(`Invalid argument sequence near ${flag ?? "the end of the command"}`)
		}
		values[flag.slice(2)] = value
	}
	const port = Number.parseInt(values.port, 10)
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error("--port must be a valid TCP port")
	}
	if (!values.version) throw new Error("--version is required")
	return {
		port,
		expectedVersion: values.version,
		downloadTimeoutMs: Number.parseInt(values["download-timeout-ms"] ?? "900000", 10),
	}
}

async function findRendererTarget(port) {
	const response = await fetch(`http://127.0.0.1:${port}/json/list`)
	if (!response.ok) throw new Error(`CDP target discovery failed with HTTP ${response.status}`)
	const targets = await response.json()
	const target = targets.find(
		(entry) =>
			entry.type === "page" &&
			typeof entry.webSocketDebuggerUrl === "string" &&
			!entry.url?.startsWith("devtools://"),
	)
	if (!target) throw new Error("Palot renderer CDP target was not found")
	return target.webSocketDebuggerUrl
}

function createCdpClient(url) {
	const socket = new WebSocket(url)
	const pending = new Map()
	let nextId = 1
	const ready = new Promise((resolve, reject) => {
		socket.addEventListener("open", resolve, { once: true })
		socket.addEventListener("error", () => reject(new Error("CDP WebSocket failed to open")), {
			once: true,
		})
	})

	socket.addEventListener("message", (event) => {
		const message = JSON.parse(event.data)
		if (!message.id) return
		const request = pending.get(message.id)
		if (!request) return
		pending.delete(message.id)
		if (message.error) request.reject(new Error(message.error.message))
		else request.resolve(message.result)
	})
	socket.addEventListener("close", () => {
		for (const request of pending.values()) request.reject(new Error("CDP WebSocket closed"))
		pending.clear()
	})

	return {
		async send(method, params = {}) {
			await ready
			const id = nextId++
			const result = new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
			socket.send(JSON.stringify({ id, method, params }))
			return await result
		},
		close() {
			socket.close()
		},
	}
}

async function evaluate(client, expression) {
	const response = await client.send("Runtime.evaluate", {
		expression,
		awaitPromise: true,
		returnByValue: true,
	})
	if (response.exceptionDetails) {
		throw new Error(
			response.exceptionDetails.exception?.description ?? "Renderer evaluation failed",
		)
	}
	return response.result?.value
}

async function retryTransientUpdaterOperation(operation, attempts = 3, baseDelayMs = 2000) {
	let lastError
	for (let attempt = 1; attempt <= attempts; attempt++) {
		try {
			return await operation()
		} catch (error) {
			lastError = error
			const message = error instanceof Error ? error.message : String(error)
			const transient = /ERR_(?:CONNECTION_CLOSED|CONNECTION_RESET|TIMED_OUT)|network|fetch/i.test(
				message,
			)
			if (!transient || attempt === attempts) throw error
			await new Promise((resolve) => setTimeout(resolve, attempt * baseDelayMs))
		}
	}
	throw lastError
}

async function runUpdaterAcceptance({ port, expectedVersion, downloadTimeoutMs }) {
	const client = createCdpClient(await findRendererTarget(port))
	try {
		await client.send("Runtime.enable")
		const result = await retryTransientUpdaterOperation(
			async () =>
				await evaluate(
					client,
					`(async () => {
				if (!window.palot?.checkForUpdates || !window.palot?.downloadUpdate) {
					throw new Error("Palot updater preload API is unavailable")
				}
				await window.palot.checkForUpdates()
				let state = await window.palot.getUpdateState()
				if (state.status === "error") throw new Error(state.error || "Update check failed")
				if (state.status !== "available") {
					throw new Error("Expected an available update, received " + state.status)
				}
				if (state.version !== ${JSON.stringify(expectedVersion)}) {
					throw new Error("Expected update ${expectedVersion}, received " + state.version)
				}
				await window.palot.downloadUpdate()
				const deadline = Date.now() + ${downloadTimeoutMs}
				do {
					state = await window.palot.getUpdateState()
					if (state.status === "ready") return { status: state.status, version: state.version }
					if (state.status === "error") throw new Error(state.error || "Update download failed")
					await new Promise((resolve) => setTimeout(resolve, 1000))
				} while (Date.now() < deadline)
				throw new Error("Update download timed out")
			})()`,
				),
		)
		if (result?.status !== "ready" || result.version !== expectedVersion) {
			throw new Error("Palot did not reach the ready update state")
		}
		await evaluate(
			client,
			`(() => {
				void window.palot.installUpdate()
				return "install-requested"
			})()`,
		)
		return result
	} finally {
		client.close()
	}
}

async function main() {
	const result = await runUpdaterAcceptance(parseArguments(process.argv.slice(2)))
	console.log(`Electron updater ready for ${result.version}; installation requested`)
}

if (require.main === module) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error))
		process.exitCode = 1
	})
}

module.exports = {
	createCdpClient,
	evaluate,
	findRendererTarget,
	parseArguments,
	retryTransientUpdaterOperation,
	runUpdaterAcceptance,
}
