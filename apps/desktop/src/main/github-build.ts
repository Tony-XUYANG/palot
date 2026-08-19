/**
 * Pure helpers for the GitHub Actions based Sealos image build.
 */

export const PALOT_BUILD_WORKFLOW = ".github/workflows/palot-sealos-build.yml";
export const PALOT_BUILD_RESULT = ".sealos/build/build-result.json";
export const PALOT_TEMPLATE_PATH = ".sealos/template/index.yaml";

const PALOT_LOCAL_PATHS = [".sealos/state.json", PALOT_BUILD_RESULT];

export interface GitHubRepositoryRef {
	owner: string;
	name: string;
	nameWithOwner: string;
}

export interface GitHubBuildResult {
	repository: string;
	branch: string;
	commit: string;
	image: string;
	runUrl: string;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function parseGitHubRemote(
	remoteUrl: string,
): GitHubRepositoryRef | null {
	const match = remoteUrl
		.trim()
		.match(
			/^(?:https?:\/\/github\.com\/|git@github\.com:)([^/]+)\/([^/]+?)(?:\.git)?$/i,
		);
	if (!match) return null;
	const owner = match[1];
	const name = match[2];
	return { owner, name, nameWithOwner: `${owner}/${name}` };
}

export function buildImageRef(
	repository: GitHubRepositoryRef,
	headSha: string,
): string {
	if (!/^[0-9a-f]{40}$/i.test(headSha))
		throw new Error("GitHub build returned an invalid commit SHA");
	return `ghcr.io/${repository.nameWithOwner.toLowerCase()}:${headSha.toLowerCase()}`;
}

export interface GitHubBuildArtifact {
	image: string;
	tag: string;
	commit: string;
}

export type GitHubContainerVisibility = "public" | "private" | "internal";

export function parseGitHubContainerVisibility(
	expectedName: string,
	value: unknown,
): GitHubContainerVisibility | null {
	if (!value || typeof value !== "object") return null;
	const container = value as Record<string, unknown>;
	if (
		String(container.name ?? "").toLowerCase() !== expectedName.toLowerCase() ||
		container.package_type !== "container"
	) {
		return null;
	}
	const visibility = String(container.visibility ?? "");
	return visibility === "public" ||
		visibility === "private" ||
		visibility === "internal"
		? visibility
		: null;
}

export function parseGitHubBuildArtifact(
	repository: GitHubRepositoryRef,
	headSha: string,
	value: unknown,
): GitHubBuildArtifact {
	if (!value || typeof value !== "object")
		throw new Error("GitHub build artifact is invalid");
	const artifact = value as Record<string, unknown>;
	const image = String(artifact.image ?? "");
	const tag = String(artifact.tag ?? "");
	const commit = String(artifact.commit ?? "").toLowerCase();
	const repositoryPath = repository.nameWithOwner.toLowerCase();
	if (
		commit !== headSha.toLowerCase() ||
		tag !== buildImageRef(repository, headSha)
	) {
		throw new Error(
			"GitHub build artifact does not match the requested commit",
		);
	}
	if (
		!new RegExp(
			`^ghcr\\.io/${escapeRegExp(repositoryPath)}@sha256:[0-9a-f]{64}$`,
		).test(image)
	) {
		throw new Error(
			"GitHub build artifact did not contain an immutable image digest",
		);
	}
	return { image, tag, commit };
}

export function parseStoredGitHubBuild(
	repository: GitHubRepositoryRef,
	value: unknown,
): GitHubBuildResult {
	if (!value || typeof value !== "object")
		throw new Error("Stored GitHub build is invalid");
	const envelope = value as Record<string, unknown>;
	if (
		envelope.version !== "1.0" ||
		!envelope.result ||
		typeof envelope.result !== "object"
	) {
		throw new Error("Stored GitHub build version is unsupported");
	}
	const result = envelope.result as Record<string, unknown>;
	const build = {
		repository: String(result.repository ?? ""),
		branch: String(result.branch ?? ""),
		commit: String(result.commit ?? "").toLowerCase(),
		image: String(result.image ?? ""),
		runUrl: String(result.runUrl ?? ""),
	};
	if (
		build.repository.toLowerCase() !== repository.nameWithOwner.toLowerCase()
	) {
		throw new Error("Stored GitHub build belongs to another repository");
	}
	if (!build.branch || !/^[0-9a-f]{40}$/.test(build.commit)) {
		throw new Error("Stored GitHub build source is invalid");
	}
	const repositoryPath = escapeRegExp(repository.nameWithOwner.toLowerCase());
	if (
		!new RegExp(`^ghcr\\.io/${repositoryPath}@sha256:[0-9a-f]{64}$`).test(
			build.image,
		)
	) {
		throw new Error("Stored GitHub build image is not immutable");
	}
	const runUrl = new URL(build.runUrl);
	if (runUrl.protocol !== "https:" || runUrl.hostname !== "github.com") {
		throw new Error("Stored GitHub Actions URL is invalid");
	}
	return build;
}

export function isGitHubBuildCurrent(
	build: GitHubBuildResult,
	branch: string,
	headCommit: string,
	changedPaths: string[],
): boolean {
	if (build.branch !== branch || build.commit !== headCommit.toLowerCase())
		return false;
	return changedPaths.every(
		(projectPath) => projectPath.replace(/\\/g, "/") === PALOT_TEMPLATE_PATH,
	);
}

export function addPalotLocalPathsToGitignore(content: string): string {
	const lines = content.split(/\r?\n/);
	const missing = PALOT_LOCAL_PATHS.filter((entry) => !lines.includes(entry));
	if (missing.length === 0) return content;
	const separator = content.length === 0 || content.endsWith("\n") ? "" : "\n";
	return `${content}${separator}${content.length > 0 ? "\n" : ""}# Palot local deployment state\n${missing.join("\n")}\n`;
}

export function isSensitiveProjectPath(projectPath: string): boolean {
	const normalized = projectPath.replace(/\\/g, "/").toLowerCase();
	const segments = normalized.split("/");
	const basename = segments.at(-1) ?? "";
	if (segments.includes(".local") || segments.includes("node_modules"))
		return true;
	if (/(^|\/)\.sealos\/(?:logs|auth(?:\.json)?)(?:\/|$)/.test(normalized))
		return true;
	if (
		basename === "kubeconfig" ||
		basename === "id_rsa" ||
		basename === "id_ed25519"
	)
		return true;
	if (
		basename === ".env" ||
		(basename.startsWith(".env.") &&
			!/^\.env\.(?:example|sample|template)$/.test(basename))
	) {
		return true;
	}
	return /\.(?:log|db|sqlite|sqlite3|pem|p12|pfx)$/i.test(basename);
}

export function createGitHubBuildWorkflow(): string {
	return `name: Palot Sealos Build
run-name: Palot build \${{ inputs.request_id }}

on:
  workflow_dispatch:
    inputs:
      request_id:
        description: Palot build request identifier
        required: true
        type: string

permissions:
  contents: read
  packages: write

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Check out source
        uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@8d2750c68a42422c14e847fe6c8ac0403b4cbd6f # v3

      - name: Sign in to GitHub Container Registry
        uses: docker/login-action@c94ce9fb468520275223c153574b00df6fe4bcc9 # v3
        with:
          registry: ghcr.io
          username: \${{ github.actor }}
          password: \${{ secrets.GITHUB_TOKEN }}

      - name: Resolve immutable image reference
        id: image
        shell: bash
        run: |
          repository="\${GITHUB_REPOSITORY,,}"
          echo "ref=ghcr.io/\${repository}:\${GITHUB_SHA}" >> "\${GITHUB_OUTPUT}"

      - name: Build and push linux/amd64 image
        id: build
        uses: docker/build-push-action@10e90e3645eae34f1e60eeb005ba3a3d33f178e8 # v6
        with:
          context: .
          file: ./Dockerfile
          platforms: linux/amd64
          push: true
          tags: \${{ steps.image.outputs.ref }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Record immutable image digest
        shell: bash
        run: |
          repository="\${GITHUB_REPOSITORY,,}"
          image_tag="ghcr.io/\${repository}:\${GITHUB_SHA}"
          digest="\${{ steps.build.outputs.digest }}"
          jq -n \\
            --arg image "ghcr.io/\${repository}@\${digest}" \\
            --arg tag "\${image_tag}" \\
            --arg commit "\${GITHUB_SHA}" \\
            '{image: $image, tag: $tag, commit: $commit}' > .palot-build-result.json

      - name: Upload immutable build result
        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4
        with:
          name: palot-sealos-build-\${{ inputs.request_id }}
          path: .palot-build-result.json
          include-hidden-files: true
          retention-days: 1
          if-no-files-found: error
`;
}
