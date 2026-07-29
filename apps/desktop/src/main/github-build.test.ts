import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
	addPalotLocalPathsToGitignore,
	buildImageRef,
	createGitHubBuildWorkflow,
	isGitHubBuildCurrent,
	isSensitiveProjectPath,
	parseGitHubBuildArtifact,
	parseGitHubRemote,
	parseStoredGitHubBuild,
} from "./github-build.ts"

describe("GitHub Actions remote build helpers", () => {
	it("parses HTTPS and SSH GitHub remotes", () => {
		assert.equal(
			parseGitHubRemote("https://github.com/Tony-XUYANG/demo.git")?.nameWithOwner,
			"Tony-XUYANG/demo",
		)
		assert.equal(parseGitHubRemote("git@github.com:owner/app.git")?.nameWithOwner, "owner/app")
		assert.equal(parseGitHubRemote("https://gitlab.com/owner/app.git"), null)
	})

	it("builds a lowercase immutable GHCR image reference", () => {
		const repo = parseGitHubRemote("https://github.com/Tony-XUYANG/Demo.git")
		assert.ok(repo)
		assert.equal(
			buildImageRef(repo, "ABCDEF0123456789ABCDEF0123456789ABCDEF01"),
			"ghcr.io/tony-xuyang/demo:abcdef0123456789abcdef0123456789abcdef01",
		)
	})

	it("generates a workflow with scoped permissions and an immutable tag", () => {
		const workflow = createGitHubBuildWorkflow()
		assert.match(workflow, /packages: write/)
		assert.match(workflow, /platforms: linux\/amd64/)
		assert.match(workflow, /\$\{GITHUB_SHA\}/)
		assert.match(workflow, /steps\.build\.outputs\.digest/)
		assert.match(workflow, /include-hidden-files: true/)
		assert.doesNotMatch(workflow, /uses: [^\n]+@v\d/)
		assert.doesNotMatch(workflow, /:latest/)
	})

	it("validates the digest artifact against its repository and commit", () => {
		const repo = parseGitHubRemote("https://github.com/Tony-XUYANG/Demo.git")
		assert.ok(repo)
		const commit = "0123456789abcdef0123456789abcdef01234567"
		assert.deepEqual(
			parseGitHubBuildArtifact(repo, commit, {
				image: `ghcr.io/tony-xuyang/demo@sha256:${"a".repeat(64)}`,
				tag: `ghcr.io/tony-xuyang/demo:${commit}`,
				commit,
			}),
			{
				image: `ghcr.io/tony-xuyang/demo@sha256:${"a".repeat(64)}`,
				tag: `ghcr.io/tony-xuyang/demo:${commit}`,
				commit,
			},
		)
	})

	it("restores only immutable build results for the current repository", () => {
		const repo = parseGitHubRemote("https://github.com/Tony-XUYANG/Demo.git")
		assert.ok(repo)
		const commit = "0123456789abcdef0123456789abcdef01234567"
		const build = parseStoredGitHubBuild(repo, {
			version: "1.0",
			result: {
				repository: "Tony-XUYANG/Demo",
				branch: "main",
				commit,
				image: `ghcr.io/tony-xuyang/demo@sha256:${"a".repeat(64)}`,
				runUrl: "https://github.com/Tony-XUYANG/Demo/actions/runs/123",
			},
		})
		assert.equal(build.commit, commit)
		assert.throws(() =>
			parseStoredGitHubBuild(repo, {
				version: "1.0",
				result: { ...build, image: "ghcr.io/tony-xuyang/demo:latest" },
			}),
		)
	})

	it("invalidates resumed builds when source or HEAD changed", () => {
		const build = {
			repository: "owner/demo",
			branch: "main",
			commit: "0123456789abcdef0123456789abcdef01234567",
			image: `ghcr.io/owner/demo@sha256:${"a".repeat(64)}`,
			runUrl: "https://github.com/owner/demo/actions/runs/123",
		}
		assert.equal(
			isGitHubBuildCurrent(build, "main", build.commit, [".sealos/template/index.yaml"]),
			true,
		)
		assert.equal(isGitHubBuildCurrent(build, "feature", build.commit, []), false)
		assert.equal(isGitHubBuildCurrent(build, "main", "f".repeat(40), []), false)
		assert.equal(isGitHubBuildCurrent(build, "main", build.commit, ["src/index.ts"]), false)
	})

	it("keeps Palot deployment state out of remote commits", () => {
		const next = addPalotLocalPathsToGitignore("node_modules/\n")
		assert.match(next, /^\.sealos\/state\.json$/m)
		assert.match(next, /^\.sealos\/build\/build-result\.json$/m)
		assert.equal(addPalotLocalPathsToGitignore(next), next)
	})

	it("blocks common local credential and state files from remote commits", () => {
		assert.equal(isSensitiveProjectPath(".env"), true)
		assert.equal(isSensitiveProjectPath(".env.local"), true)
		assert.equal(isSensitiveProjectPath(".env.example"), false)
		assert.equal(isSensitiveProjectPath(".local/agent-smoke/output.log"), true)
		assert.equal(isSensitiveProjectPath("data/test.sqlite"), true)
		assert.equal(isSensitiveProjectPath("src/index.ts"), false)
	})
})
