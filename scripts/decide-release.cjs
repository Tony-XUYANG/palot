/**
 * Decides whether the release workflow may build artifacts after Changesets runs.
 */

const { appendFileSync } = require("node:fs")

function parseBoolean(value, label) {
	if (value === "true") return true
	if (value === "false") return false
	throw new Error(`${label} must be true or false`)
}

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

	return {
		published: parseBoolean(values.published, "--published"),
		hasChangesets: parseBoolean(values["has-changesets"], "--has-changesets"),
		rebuildCurrent: parseBoolean(values["rebuild-current"], "--rebuild-current"),
		tagExists: parseBoolean(values["tag-exists"], "--tag-exists"),
		githubOutput: values["github-output"] ?? null,
	}
}

function decideRelease({ published, hasChangesets, rebuildCurrent, tagExists }) {
	if (hasChangesets) {
		return {
			shouldRelease: false,
			reason: "version-pr-created-or-updated",
		}
	}
	if (published) return { shouldRelease: true, reason: "packages-published" }
	if (rebuildCurrent) return { shouldRelease: true, reason: "explicit-rebuild" }
	if (!tagExists) return { shouldRelease: true, reason: "unreleased-version" }
	return { shouldRelease: false, reason: "version-already-released" }
}

function main() {
	const options = parseArguments(process.argv.slice(2))
	const decision = decideRelease(options)
	if (options.githubOutput) {
		appendFileSync(
			options.githubOutput,
			`should-release=${decision.shouldRelease}\nrelease-reason=${decision.reason}\n`,
		)
	}
	console.log(JSON.stringify(decision))
}

if (require.main === module) {
	try {
		main()
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error))
		process.exitCode = 1
	}
}

module.exports = {
	decideRelease,
	parseArguments,
}
