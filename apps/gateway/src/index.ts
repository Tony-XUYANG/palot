/**
 * Palot Cloud gateway process entrypoint.
 */

import { createGatewayApp } from "./app"
import { readGatewayConfig } from "./config"
import { PostgresGatewayRepository } from "./postgres-repository"

const config = readGatewayConfig()
const repository = new PostgresGatewayRepository(config.databaseUrl, config.tokenPepper)
await repository.migrate()

const app = createGatewayApp({ repository, config })

let closing = false
const close = async () => {
	if (closing) return
	closing = true
	await repository.close()
	process.exit(0)
}

process.on("SIGINT", close)
process.on("SIGTERM", close)

console.log(`Palot Cloud gateway listening on port ${config.port}`)

export default {
	port: config.port,
	fetch: app.fetch,
}
