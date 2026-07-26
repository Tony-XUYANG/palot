/**
 * GitHub browser authentication and Actions-based container builds.
 */

import { type ChildProcessWithoutNullStreams, execFile, spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import { app } from "electron"
import {
	createGitHubBuildWorkflow,
	type GitHubRepositoryRef,
	isSensitiveProjectPath,
	PALOT_BUILD_WORKFLOW,
	parseGitHubBuildArtifact,
	parseGitHubRemote,
} from "./github-build"
import { resolveGitHubRuntime, resolveGitRuntime } from "./runtime-resolver"

const execFileAsync = promisify(execFile)
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000
const BUILD_TIMEOUT_MS = 30 * 60 * 1000

interface PendingGitHubLogin {
	process: ChildProcessWithoutNullStreams
	completion: Promise<void>
	output: string
}

interface GitHubRun {
	databaseId: number
	displayTitle: string
	status: string
	conclusion: string
	url: string
	headSha: string
}

const pendingLogins = new Map<string, PendingGitHubLogin>()

export interface GitHubBuildStatus {
	cliAvailable: boolean
	authenticated: boolean
	login: string | null
	repository: string | null
	branch: string | null
	clean: boolean
	dockerfile: boolean
	workflow: boolean
	ready: boolean
	detail: string
}

export interface GitHubLoginStartResult {
	sessionId: string
	userCode: string | null
	verificationUrl: string
}

export interface GitHubSourceResult {
	repository: string
	branch: string
	commit: string
}

export interface GitHubBuildProgress {
	stage: "repository" | "dispatch" | "queued" | "building" | "publishing" | "complete"
	status: "active" | "complete"
	detail: string
	runUrl?: string
}

export interface GitHubBuildResult {
	repository: string
	branch: string
	commit: string
	image: string
	runUrl: string
}

function runtimeOptions() {
	return { isPackaged: app.isPackaged, resourcesPath: process.resourcesPath }
}

function getGitHubPath(): string {
	const runtime = resolveGitHubRuntime(runtimeOptions())
	if (runtime) return runtime.path
	throw new Error(
		app.isPackaged && process.platform === "win32"
			? "The included GitHub CLI is missing. Reinstall Palot to repair the installation."
			: "GitHub CLI was not found. Install gh or configure PALOT_TEST_GH_PATH for development.",
	)
}

function getGitPath(): string {
	const runtime = resolveGitRuntime(runtimeOptions())
	if (runtime) return runtime.path
	throw new Error("Git was not found")
}

async function command(binary: string, args: string[], cwd?: string): Promise<string> {
	const { stdout } = await execFileAsync(binary, args, {
		cwd,
		encoding: "utf8",
		maxBuffer: 10 * 1024 * 1024,
		windowsHide: true,
	})
	return stdout.trim()
}

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await access(filePath)
		return true
	} catch {
		return false
	}
}

async function getRepository(directory: string): Promise<GitHubRepositoryRef | null> {
	try {
		const remote = await command(getGitPath(), ["remote", "get-url", "origin"], directory)
		return parseGitHubRemote(remote)
	} catch {
		return null
	}
}

async function getBranch(directory: string): Promise<string | null> {
	try {
		return (await command(getGitPath(), ["branch", "--show-current"], directory)) || null
	} catch {
		return null
	}
}

async function getLogin(ghPath: string): Promise<string | null> {
	try {
		return await command(ghPath, ["api", "user", "--jq", ".login"])
	} catch {
		return null
	}
}

export async function getGitHubBuildStatus(directory: string): Promise<GitHubBuildStatus> {
	let ghPath: string
	try {
		ghPath = getGitHubPath()
	} catch (error) {
		return {
			cliAvailable: false,
			authenticated: false,
			login: null,
			repository: null,
			branch: null,
			clean: false,
			dockerfile: false,
			workflow: false,
			ready: false,
			detail: error instanceof Error ? error.message : "GitHub CLI is unavailable",
		}
	}

	const resolved = path.resolve(directory)
	const [login, repository, branch, status, dockerfile, workflow] = await Promise.all([
		getLogin(ghPath),
		getRepository(resolved),
		getBranch(resolved),
		command(getGitPath(), ["status", "--porcelain"], resolved).catch(() => "unavailable"),
		fileExists(path.join(resolved, "Dockerfile")),
		fileExists(path.join(resolved, PALOT_BUILD_WORKFLOW)),
	])
	const clean = status === ""
	const authenticated = Boolean(login)
	const ready =
		authenticated && Boolean(repository) && Boolean(branch) && clean && dockerfile && workflow
	const problems: string[] = []
	if (!authenticated) problems.push("Sign in to GitHub")
	if (!repository) problems.push("Add a GitHub origin remote")
	if (!branch) problems.push("Check out a branch")
	if (!dockerfile) problems.push("Generate a Dockerfile")
	if (!workflow) problems.push("Prepare the remote build workflow")
	if (!clean) problems.push("Commit and push project changes")

	return {
		cliAvailable: true,
		authenticated,
		login,
		repository: repository?.nameWithOwner ?? null,
		branch,
		clean,
		dockerfile,
		workflow,
		ready,
		detail: ready ? "Ready for a Docker-free GitHub Actions build" : problems.join("; "),
	}
}

export async function startGitHubLogin(): Promise<GitHubLoginStartResult> {
	const ghPath = getGitHubPath()
	const child = spawn(
		ghPath,
		[
			"auth",
			"login",
			"--hostname",
			"github.com",
			"--git-protocol",
			"https",
			"--web",
			"--skip-ssh-key",
			"--scopes",
			"repo,workflow,write:packages",
		],
		{
			env: { ...process.env, GH_PROMPT_DISABLED: "1" },
			windowsHide: true,
		},
	)
	const sessionId = randomUUID()
	let output = ""
	let settle: (() => void) | null = null
	let rejectCompletion: ((error: Error) => void) | null = null
	const completion = new Promise<void>((resolve, reject) => {
		settle = resolve
		rejectCompletion = reject
	})
	const pending: PendingGitHubLogin = { process: child, completion, output }
	pendingLogins.set(sessionId, pending)
	const collect = (chunk: Buffer) => {
		output += chunk.toString("utf8")
		pending.output = output
	}
	child.stdout.on("data", collect)
	child.stderr.on("data", collect)
	child.on("error", (error) => rejectCompletion?.(error))
	child.on("close", (code) => {
		if (code === 0) settle?.()
		else rejectCompletion?.(new Error(output.trim() || `GitHub login exited with code ${code}`))
	})

	const startedAt = Date.now()
	while (Date.now() - startedAt < 30_000) {
		const userCode = output.match(/([A-Z0-9]{4}-[A-Z0-9]{4})/)?.[1] ?? null
		if (userCode || /github\.com\/login\/device/i.test(output)) {
			return { sessionId, userCode, verificationUrl: "https://github.com/login/device" }
		}
		if (child.exitCode !== null) await completion
		await new Promise((resolve) => setTimeout(resolve, 200))
	}
	child.kill()
	pendingLogins.delete(sessionId)
	throw new Error("GitHub login did not provide an authorization code")
}

export async function completeGitHubLogin(sessionId: string): Promise<{ login: string }> {
	const pending = pendingLogins.get(sessionId)
	if (!pending) throw new Error("GitHub login session expired")
	try {
		await Promise.race([
			pending.completion,
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error("GitHub login timed out")), LOGIN_TIMEOUT_MS),
			),
		])
		const login = await getLogin(getGitHubPath())
		if (!login) throw new Error("GitHub login completed without an active account")
		return { login }
	} finally {
		pendingLogins.delete(sessionId)
	}
}

export async function prepareGitHubBuild(
	directory: string,
): Promise<{ path: string; changed: boolean }> {
	const resolved = path.resolve(directory)
	if (!(await fileExists(path.join(resolved, "Dockerfile")))) {
		throw new Error("Generate and review a production Dockerfile before preparing remote builds")
	}
	const workflowPath = path.join(resolved, PALOT_BUILD_WORKFLOW)
	const content = createGitHubBuildWorkflow()
	let previous = ""
	try {
		previous = await readFile(workflowPath, "utf8")
	} catch {
		// The workflow will be created below.
	}
	if (previous === content) return { path: workflowPath, changed: false }
	await mkdir(path.dirname(workflowPath), { recursive: true })
	await writeFile(workflowPath, content, "utf8")
	return { path: workflowPath, changed: true }
}

export async function publishGitHubSource(directory: string): Promise<GitHubSourceResult> {
	const resolved = path.resolve(directory)
	const repository = await getRepository(resolved)
	const branch = await getBranch(resolved)
	if (!repository) throw new Error("The project origin is not a GitHub repository")
	if (!branch) throw new Error("A named Git branch is required for remote builds")
	const git = getGitPath()
	const dirty = await command(git, ["status", "--porcelain"], resolved)
	if (dirty) {
		const changedPaths = new Set<string>()
		const pathOutputs = await Promise.all([
			command(git, ["diff", "--name-only", "-z"], resolved),
			command(git, ["diff", "--cached", "--name-only", "-z"], resolved),
			command(git, ["ls-files", "--others", "--exclude-standard", "-z"], resolved),
		])
		for (const output of pathOutputs) {
			for (const file of output.split("\0")) {
				if (file) changedPaths.add(file)
			}
		}
		const blocked = [...changedPaths].filter(isSensitiveProjectPath)
		if (blocked.length > 0) {
			throw new Error(
				`Remote build blocked because sensitive local files would be committed: ${blocked.join(", ")}`,
			)
		}
		await command(git, ["add", "-A"], resolved)
		await command(git, ["commit", "-m", "chore: prepare Sealos deployment"], resolved)
	}
	await command(git, ["push", "--set-upstream", "origin", branch], resolved)
	const commit = await command(git, ["rev-parse", "HEAD"], resolved)
	return { repository: repository.nameWithOwner, branch, commit }
}

async function makeContainerPublic(ghPath: string, repository: GitHubRepositoryRef): Promise<void> {
	const login = await getLogin(ghPath)
	if (!login) throw new Error("GitHub authentication expired")
	const packageName = encodeURIComponent(repository.name)
	const endpoint =
		login.toLowerCase() === repository.owner.toLowerCase()
			? `/user/packages/container/${packageName}`
			: `/orgs/${repository.owner}/packages/container/${packageName}`
	await command(ghPath, ["api", "--method", "PATCH", endpoint, "-f", "visibility=public"])
}

export async function runGitHubBuild(
	directory: string,
	onProgress: (progress: GitHubBuildProgress) => void,
): Promise<GitHubBuildResult> {
	const status = await getGitHubBuildStatus(directory)
	if (!status.ready || !status.repository || !status.branch) throw new Error(status.detail)
	const repository = parseGitHubRemote(`https://github.com/${status.repository}`)
	if (!repository) throw new Error("GitHub repository could not be resolved")
	const gh = getGitHubPath()
	const requestId = randomUUID().slice(0, 8)
	const title = `Palot build ${requestId}`
	onProgress({ stage: "repository", status: "complete", detail: status.repository })
	onProgress({ stage: "dispatch", status: "active", detail: "Starting GitHub Actions build" })
	await command(gh, [
		"workflow",
		"run",
		PALOT_BUILD_WORKFLOW,
		"--repo",
		repository.nameWithOwner,
		"--ref",
		status.branch,
		"-f",
		`request_id=${requestId}`,
	])
	onProgress({ stage: "dispatch", status: "complete", detail: "Build requested" })

	const startedAt = Date.now()
	let run: GitHubRun | null = null
	while (Date.now() - startedAt < BUILD_TIMEOUT_MS) {
		const raw = await command(gh, [
			"run",
			"list",
			"--workflow",
			path.basename(PALOT_BUILD_WORKFLOW),
			"--branch",
			status.branch,
			"--repo",
			repository.nameWithOwner,
			"--json",
			"databaseId,displayTitle,status,conclusion,url,headSha",
			"--limit",
			"30",
		])
		const runs = JSON.parse(raw) as GitHubRun[]
		run = runs.find((candidate) => candidate.displayTitle === title) ?? null
		if (!run) {
			onProgress({ stage: "queued", status: "active", detail: "Waiting for a GitHub runner" })
		} else if (run.status !== "completed") {
			onProgress({
				stage: "building",
				status: "active",
				detail: "Building linux/amd64 image",
				runUrl: run.url,
			})
		} else {
			break
		}
		await new Promise((resolve) => setTimeout(resolve, 5_000))
	}
	if (!run || run.status !== "completed") throw new Error("GitHub Actions build timed out")
	if (run.conclusion !== "success") {
		throw new Error(`GitHub Actions build failed (${run.conclusion}). Open ${run.url}`)
	}
	onProgress({
		stage: "publishing",
		status: "active",
		detail: "Publishing the GHCR image",
		runUrl: run.url,
	})
	const artifactDirectory = await mkdtemp(path.join(app.getPath("temp"), "palot-gh-build-"))
	const artifactPath = path.join(artifactDirectory, ".palot-build-result.json")
	let artifact: ReturnType<typeof parseGitHubBuildArtifact>
	try {
		await command(gh, [
			"run",
			"download",
			String(run.databaseId),
			"--repo",
			repository.nameWithOwner,
			"--name",
			`palot-sealos-build-${requestId}`,
			"--dir",
			artifactDirectory,
		])
		artifact = parseGitHubBuildArtifact(
			repository,
			run.headSha,
			JSON.parse(await readFile(artifactPath, "utf8")),
		)
	} finally {
		await rm(artifactPath, { force: true }).catch(() => undefined)
		await rm(artifactDirectory, { force: true }).catch(() => undefined)
	}
	await makeContainerPublic(gh, repository)
	const image = artifact.image
	onProgress({ stage: "complete", status: "complete", detail: image, runUrl: run.url })
	return {
		repository: repository.nameWithOwner,
		branch: status.branch,
		commit: run.headSha,
		image,
		runUrl: run.url,
	}
}
