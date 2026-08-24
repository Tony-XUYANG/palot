/**
 * Verifies Palot's packaged updater source through the preload API over loopback CDP.
 */

const {
	createCdpClient,
	evaluate,
	findRendererTarget,
	retryTransientUpdaterOperation,
} = require("./run-electron-updater-driver.cjs")

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

	const expectedSource = values.source ?? "china"
	if (expectedSource !== "china" && expectedSource !== "github") {
		throw new Error("--source must be china or github")
	}

	return {
		port,
		expectedVersion: values.version,
		expectedSource,
	}
}

function assertUpdateSourceResult(result, { expectedVersion, expectedSource }) {
	if (result?.appInfo?.version !== expectedVersion) {
		throw new Error(
			`Expected installed version ${expectedVersion}, received ${result?.appInfo?.version ?? "unknown"}`,
		)
	}
	if (result?.state?.status !== "idle") {
		throw new Error(
			`Expected the current release to remain idle, received ${result?.state?.status ?? "unknown"}`,
		)
	}
	if (result.state.source !== expectedSource) {
		throw new Error(
			`Expected update source ${expectedSource}, received ${result.state.source ?? "unknown"}`,
		)
	}
	if (result.state.fallbackUsed !== false) {
		throw new Error("The updater reached its source through fallback instead of the primary feed")
	}
	return result
}

async function runUpdateSourceAcceptance({ port, expectedVersion, expectedSource }) {
	const client = createCdpClient(await findRendererTarget(port))
	try {
		await client.send("Runtime.enable")
		const result = await retryTransientUpdaterOperation(
			async () =>
				await evaluate(
					client,
					`(async () => {
				const deadline = Date.now() + 30000
				while (
					(!window.palot?.checkForUpdates || !window.palot?.getUpdateState || !window.palot?.getAppInfo) &&
					Date.now() < deadline
				) {
					await new Promise((resolve) => setTimeout(resolve, 250))
				}
				if (!window.palot?.checkForUpdates || !window.palot?.getUpdateState || !window.palot?.getAppInfo) {
					throw new Error("Palot updater preload API is unavailable")
				}
				await new Promise((resolve) => setTimeout(resolve, 1000))
				await window.palot.checkForUpdates()
				return {
					appInfo: await window.palot.getAppInfo(),
					state: await window.palot.getUpdateState(),
				}
			})()`,
				),
		)
		return assertUpdateSourceResult(result, { expectedVersion, expectedSource })
	} finally {
		client.close()
	}
}

async function main() {
	const options = parseArguments(process.argv.slice(2))
	const result = await runUpdateSourceAcceptance(options)
	console.log(
		`Electron updater source passed: ${result.appInfo.version}, ${result.state.source}, no fallback`,
	)
}

if (require.main === module) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error))
		process.exitCode = 1
	})
}

module.exports = {
	assertUpdateSourceResult,
	parseArguments,
	runUpdateSourceAcceptance,
}
