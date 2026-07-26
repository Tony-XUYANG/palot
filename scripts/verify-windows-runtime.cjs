const { existsSync, readFileSync } = require("node:fs")
const path = require("node:path")
const { spawnSync } = require("node:child_process")

function readJson(file) {
	return JSON.parse(readFileSync(file, "utf8"))
}

function verifyVersion(executable, expected, args = ["--version"]) {
	const result = spawnSync(executable, args, {
		encoding: "utf8",
		env: { ...process.env, PATH: "" },
		timeout: 10000,
	})
	if (result.error || result.status !== 0) {
		throw new Error(`Bundled runtime failed to execute: ${executable}`)
	}
	const output = `${result.stdout}\n${result.stderr}`
	if (!output.includes(expected)) {
		throw new Error(`Bundled runtime version mismatch for ${executable}: ${output.trim()}`)
	}
}

module.exports = async function verifyWindowsRuntime(context) {
	if (context.electronPlatformName !== "win32") return

	const projectDir = context.packager.projectDir
	const manifestPath = path.join(projectDir, "runtime-manifest.json")
	const runtimeRoot = path.join(projectDir, "resources", "runtime", "win32-x64")
	const preparedManifestPath = path.join(runtimeRoot, "runtime-manifest.json")
	if (!existsSync(preparedManifestPath)) {
		throw new Error("Windows runtimes are missing. Run `bun run runtime:prepare:win` before packaging.")
	}

	const manifestText = readFileSync(manifestPath, "utf8").trim()
	const preparedManifestText = readFileSync(preparedManifestPath, "utf8").trim()
	if (manifestText !== preparedManifestText) {
		throw new Error("Prepared Windows runtimes are stale. Run `bun run runtime:prepare:win` again.")
	}

	const manifest = readJson(manifestPath)
	const openCodePath = path.join(runtimeRoot, manifest.runtimes.opencode.executable)
	const gitPath = path.join(runtimeRoot, manifest.runtimes.mingit.executable)
	const githubPath = path.join(runtimeRoot, manifest.runtimes.github.executable)
	const kubectlPath = path.join(runtimeRoot, manifest.runtimes.kubectl.executable)
	const requiredFiles = [
		openCodePath,
		gitPath,
		githubPath,
		kubectlPath,
		path.join(runtimeRoot, "github", "LICENSE"),
		path.join(runtimeRoot, "mingit", "LICENSE.txt"),
		path.join(runtimeRoot, "licenses", "palot-MIT.txt"),
		path.join(runtimeRoot, "licenses", "opencode-MIT.txt"),
		path.join(runtimeRoot, "licenses", "github-cli-MIT.txt"),
		path.join(runtimeRoot, "licenses", "THIRD-PARTY-NOTICES.md"),
		path.join(runtimeRoot, "licenses", "THIRD-PARTY-SOURCE-OFFER.txt"),
	]
	for (const file of requiredFiles) {
		if (!existsSync(file)) throw new Error(`Required Windows runtime file is missing: ${file}`)
	}

	verifyVersion(openCodePath, manifest.runtimes.opencode.version)
	const gitVersion = manifest.runtimes.mingit.version.replace(/^(\d+\.\d+\.\d+)\.(\d+)$/, "$1.windows.$2")
	verifyVersion(gitPath, gitVersion)
	verifyVersion(githubPath, manifest.runtimes.github.version)
	verifyVersion(kubectlPath, manifest.runtimes.kubectl.version, ["version", "--client=true"])
}
