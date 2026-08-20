/**
 * Guided source-to-Sealos deployment workflow.
 */

import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@palot/ui/components/alert";
import { Badge } from "@palot/ui/components/badge";
import { Button } from "@palot/ui/components/button";
import { Input } from "@palot/ui/components/input";
import { useNavigate } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import {
	CheckCircle2Icon,
	CircleIcon,
	CloudUploadIcon,
	ExternalLinkIcon,
	GithubIcon,
	Loader2Icon,
	LogInIcon,
	RefreshCwIcon,
	RocketIcon,
	SparklesIcon,
	TriangleAlertIcon,
	XCircleIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
	GitHubBuildProgress,
	GitHubBuildResult,
	GitHubBuildStatus,
	SealosDeploymentState,
	SealosDeployResult,
	SealosPreflightResult,
	SealosRuntimeResult,
	SealosTemplateInput,
	SealosWorkspace,
} from "../../preload/api";
import { isMockModeAtom } from "../atoms/mock-mode";
import { setDraftAtom } from "../atoms/preferences";
import { appStore } from "../atoms/store";
import { useProjectList } from "../hooks/use-agents";
import { NEW_CHAT_DRAFT_KEY } from "../hooks/use-draft";

const SEALOS_REGIONS = [
	{ value: "https://gzg.sealos.run", label: "Guangzhou" },
	{ value: "https://bja.sealos.run", label: "Beijing" },
	{ value: "https://hzh.sealos.run", label: "Hangzhou" },
	{ value: "https://usw-1.sealos.io", label: "US West" },
];

type DeploymentPipelineStage = "build" | "deploy" | "verify";
type DeploymentPipelineStatus = "pending" | "active" | "complete" | "error";

interface DeploymentPipelineStep {
	id: DeploymentPipelineStage;
	label: string;
	status: DeploymentPipelineStatus;
	detail: string;
}

function createDeploymentPipelineSteps(
	build: GitHubBuildResult | null,
	buildApplied: boolean,
	isUpdate: boolean,
	t: (key: string) => string,
): DeploymentPipelineStep[] {
	return [
		{
			id: "build",
			label: t("deploy.remoteBuild"),
			status: build ? "complete" : "pending",
			detail: build ? build.image : t("deploy.waiting"),
		},
		{
			id: "deploy",
			label: isUpdate ? t("deploy.updateDeployment") : t("deploy.deployment"),
			status: buildApplied ? "complete" : "pending",
			detail: buildApplied
				? t("deploy.currentImageDeployed")
				: t("deploy.waitingImage"),
		},
		{
			id: "verify",
			label: t("deploy.health"),
			status: "pending",
			detail: t("deploy.healthDescription"),
		},
	];
}

const PREPARE_DEPLOYMENT_PROMPT = `Prepare this web project for deployment to Sealos Cloud.

1. Analyze the real build, start command, listening host, port, environment variables, migrations, storage, and external services.
2. Add or run the project's automated checks. Fix failures before preparing deployment.
3. Create a production multi-stage Dockerfile and workspace-aware .dockerignore. Use a non-root runtime, bind to 0.0.0.0, expose the detected port, use pinned base versions, and add a /health endpoint.
4. Generate .sealos/template/index.yaml using the current Sealos Template CR format. Include Deployment, Service, root Ingress, and App resources with consistent app labels and names. Use IfNotPresent, limits cpu=200m and memory=256Mi, requests cpu=20m and memory=25Mi, revisionHistoryLimit 1, and automountServiceAccountToken false unless the app requires Kubernetes API access.
5. Do not use floating image tags, emptyDir, raw database Deployments, or expose secrets in generated files. Use KubeBlocks resources for databases.
6. Validate the generated files and summarize required user inputs. Do not deploy or require local Docker; Palot will build the image with GitHub Actions after review.`;

function statusIcon(status: "ready" | "missing" | "warning") {
	return status === "ready"
		? CheckCircle2Icon
		: status === "warning"
			? TriangleAlertIcon
			: XCircleIcon;
}

export function SealosDeployPage() {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const isMockMode = useAtomValue(isMockModeAtom);
	const projects = useProjectList();
	const [directory, setDirectory] = useState("");
	const [region, setRegion] = useState("https://hzh.sealos.run");
	const [result, setResult] = useState<SealosPreflightResult | null>(null);
	const [github, setGitHub] = useState<GitHubBuildStatus | null>(null);
	const [build, setBuild] = useState<GitHubBuildResult | null>(null);
	const [buildProgress, setBuildProgress] = useState<GitHubBuildProgress[]>([]);
	const [workspaces, setWorkspaces] = useState<SealosWorkspace[]>([]);
	const [templateInputs, setTemplateInputs] = useState<SealosTemplateInput[]>(
		[],
	);
	const [inputValues, setInputValues] = useState<Record<string, string>>({});
	const [deployment, setDeployment] = useState<SealosDeployResult | null>(null);
	const [deploymentState, setDeploymentState] =
		useState<SealosDeploymentState | null>(null);
	const [updated, setUpdated] = useState(false);
	const [runtime, setRuntime] = useState<SealosRuntimeResult | null>(null);
	const [pipelineSteps, setPipelineSteps] = useState<DeploymentPipelineStep[]>(
		[],
	);
	const [checking, setChecking] = useState(false);
	const [action, setAction] = useState<string | null>(null);
	const [loginCode, setLoginCode] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!directory && projects[0]?.directory)
			setDirectory(projects[0].directory);
	}, [directory, projects]);

	useEffect(() => {
		if (!window.palot?.sealos) return;
		return window.palot.sealos.onGitHubBuildProgress((progress) => {
			setBuildProgress((current) => {
				const next = current.filter((item) => item.stage !== progress.stage);
				return [...next, progress];
			});
			setPipelineSteps((current) =>
				current.map((step) =>
					step.id === "build"
						? {
								...step,
								status: progress.status === "complete" ? "complete" : "active",
								detail: progress.detail,
							}
						: step,
				),
			);
		});
	}, []);

	const selectedProject = useMemo(
		() => projects.find((project) => project.directory === directory),
		[projects, directory],
	);
	const missingIds = useMemo(
		() =>
			new Set(
				result?.checks
					.filter((check) => check.status === "missing")
					.map((check) => check.id),
			),
		[result],
	);
	const activeWorkspace = useMemo(
		() =>
			workspaces.find((workspace) => workspace.current) ??
			workspaces[0] ??
			null,
		[workspaces],
	);
	const requiredInputsReady = templateInputs.every(
		(input) =>
			!input.required ||
			Boolean(inputValues[input.name]?.trim() || input.defaultValue),
	);
	const publicUrl =
		deployment?.appUrl ?? deploymentState?.last_deploy.url ?? null;
	const activePipelineStep =
		pipelineSteps.find((step) => step.status === "active") ?? null;
	const pipelineHasError = pipelineSteps.some(
		(step) => step.status === "error",
	);

	const refresh = async () => {
		if (!directory) return;
		setChecking(true);
		setError(null);
		try {
			if (isMockMode) {
				setResult({
					projectName: "palot-demo",
					framework: "Node.js",
					port: 3000,
					region: "https://hzh.sealos.run",
					workspace: "ns-demo",
					ready: true,
					checks: [
						{
							id: "project",
							label: "Web project",
							status: "ready",
							detail: "Node.js project detected",
						},
						{
							id: "git",
							label: "Git",
							status: "ready",
							detail: "Included with Palot",
						},
						{
							id: "docker",
							label: "Docker",
							status: "warning",
							detail: "Not required for remote builds",
						},
						{
							id: "sealos",
							label: "Sealos CLI",
							status: "ready",
							detail: "Deployment is built in",
						},
						{
							id: "auth",
							label: "Sealos account",
							status: "ready",
							detail: "Signed in",
						},
						{
							id: "container",
							label: "Sealos template",
							status: "ready",
							detail: "Ready for validation",
						},
					],
				});
				setGitHub({
					cliAvailable: true,
					authenticated: true,
					login: "demo-user",
					repository: "demo-user/palot-demo",
					branch: "main",
					clean: true,
					dockerfile: true,
					workflow: true,
					ready: true,
					detail: "Ready for a Docker-free GitHub Actions build",
				});
				setWorkspaces([
					{
						uid: "demo",
						id: "ns-demo",
						teamName: "private team",
						current: true,
					},
				]);
				setTemplateInputs([]);
				return;
			}
			if (!window.palot?.sealos) return;
			const [nextResult, nextGitHub, nextDeploymentState, nextBuild] =
				await Promise.all([
					window.palot.sealos.preflight(directory),
					window.palot.sealos.getGitHubStatus(directory),
					window.palot.sealos.getDeploymentState(directory),
					window.palot.sealos.getGitHubBuildResult(directory),
				]);
			setResult(nextResult);
			setGitHub(nextGitHub);
			setDeploymentState(nextDeploymentState);
			setBuild(nextBuild);
			if (nextResult.region) setRegion(nextResult.region);
			const [nextWorkspaces, nextInputs] = await Promise.all([
				nextResult.checks.some(
					(check) => check.id === "auth" && check.status === "ready",
				)
					? window.palot.sealos.listWorkspaces()
					: Promise.resolve([]),
				nextResult.checks.some(
					(check) => check.id === "container" && check.status === "ready",
				)
					? window.palot.sealos.readTemplateInputs(directory)
					: Promise.resolve([]),
			]);
			setWorkspaces(nextWorkspaces);
			setTemplateInputs(nextInputs);
			setInputValues((current) => {
				const next = { ...current };
				for (const input of nextInputs) {
					if (!(input.name in next) && input.defaultValue !== null)
						next[input.name] = input.defaultValue;
				}
				return next;
			});
		} catch (err) {
			setError(err instanceof Error ? err.message : t("deploy.checksFailed"));
		} finally {
			setChecking(false);
		}
	};

	const runAction = async (name: string, callback: () => Promise<void>) => {
		setAction(name);
		setError(null);
		try {
			await callback();
		} catch (err) {
			setError(
				err instanceof Error
					? err.message
					: t("common.errors.operationFailed", { error: name }),
			);
		} finally {
			setAction(null);
		}
	};

	const signInToSealos = () =>
		runAction("sealos-login", async () => {
			const login = await window.palot.sealos.startLogin(region);
			setLoginCode(login.userCode);
			await window.palot.sealos.completeLogin(login.sessionId);
			setLoginCode(null);
			await refresh();
		});

	const signInToGitHub = () =>
		runAction("github-login", async () => {
			const login = await window.palot.sealos.startGitHubLogin();
			setLoginCode(login.userCode);
			await window.palot.sealos.completeGitHubLogin(login.sessionId);
			setLoginCode(null);
			await refresh();
		});

	const prepareWithAgent = () => {
		if (!selectedProject) return;
		appStore.set(setDraftAtom, {
			key: NEW_CHAT_DRAFT_KEY,
			text: PREPARE_DEPLOYMENT_PROMPT,
		});
		navigate({
			to: "/project/$projectSlug",
			params: { projectSlug: selectedProject.slug },
		});
	};

	const prepareRemoteBuild = () =>
		runAction("prepare", async () => {
			await window.palot.sealos.prepareGitHubBuild(directory);
			await refresh();
		});

	const publishSource = () =>
		runAction("publish", async () => {
			await window.palot.sealos.publishGitHubSource(directory);
			await refresh();
		});

	const executeRemoteBuild = async (): Promise<GitHubBuildResult> => {
		setBuildProgress([]);
		setDeployment(null);
		setUpdated(false);
		setRuntime(null);
		if (isMockMode) {
			const mockBuild = {
				repository: "demo-user/palot-demo",
				branch: "main",
				commit: "0123456789abcdef0123456789abcdef01234567",
				image: `ghcr.io/demo-user/palot-demo@sha256:${"a".repeat(64)}`,
				runUrl: "https://github.com/demo-user/palot-demo/actions",
			};
			setBuildProgress([
				{
					stage: "repository",
					status: "complete",
					detail: "demo-user/palot-demo",
				},
				{ stage: "dispatch", status: "complete", detail: "Build requested" },
				{ stage: "complete", status: "complete", detail: mockBuild.image },
			]);
			setBuild(mockBuild);
			return mockBuild;
		}
		const nextBuild = await window.palot.sealos.runGitHubBuild(directory);
		setBuild(nextBuild);
		return nextBuild;
	};

	const buildRemotely = () =>
		runAction("build", async () => {
			await executeRemoteBuild();
			if (!isMockMode) await refresh();
		});

	const switchWorkspace = (workspaceId: string) =>
		runAction("workspace", async () => {
			await window.palot.sealos.switchWorkspace(workspaceId);
			await refresh();
		});

	const executeDeployment = async (): Promise<string> => {
		if (isMockMode) {
			const nextDeployment = {
				success: true,
				status: 201,
				region: "https://hzh.sealos.run",
				response: {},
				appUrl: "https://palot-demo.hzh.sealos.run",
				instanceName: "palot-demo-ab12cd34",
				logPath: "~/.sealos/logs/deploy-demo.log",
			};
			setDeployment(nextDeployment);
			return nextDeployment.appUrl;
		}
		if (deploymentState) {
			const update = await window.palot.sealos.updateDeployment(directory);
			setUpdated(true);
			const nextState = await window.palot.sealos.getDeploymentState(directory);
			setDeploymentState(nextState);
			const url = update.url ?? nextState?.last_deploy.url;
			if (!url)
				throw new Error("The updated deployment did not return a public URL");
			return url;
		}
		const nextDeployment = await window.palot.sealos.deploy(
			directory,
			inputValues,
		);
		setDeployment(nextDeployment);
		const nextState = await window.palot.sealos.getDeploymentState(directory);
		setDeploymentState(nextState);
		const url = nextDeployment.appUrl ?? nextState?.last_deploy.url;
		if (!url) throw new Error("The deployment did not return a public URL");
		return url;
	};

	const executeRuntimeVerification = async (
		url: string,
	): Promise<SealosRuntimeResult> => {
		if (isMockMode) {
			const nextRuntime: SealosRuntimeResult = {
				ok: true,
				status: 200,
				url,
				detail: "Public runtime checks passed",
				checks: [
					{ id: "root", ok: true, detail: "Root returned HTTP 200" },
					{ id: "health", ok: true, detail: "/health returned HTTP 200" },
					{
						id: "missing-path",
						ok: true,
						detail: "Random missing path returned HTTP 404",
					},
					{
						id: "failure-text",
						ok: true,
						detail: "No browser failure text found",
					},
				],
			};
			setRuntime(nextRuntime);
			return nextRuntime;
		}
		const nextRuntime = await window.palot.sealos.verifyRuntime(directory, url);
		setRuntime(nextRuntime);
		return nextRuntime;
	};

	const updatePipelineStep = (
		id: DeploymentPipelineStage,
		status: DeploymentPipelineStatus,
		detail: string,
	) => {
		setPipelineSteps((current) =>
			current.map((step) =>
				step.id === id ? { ...step, status, detail } : step,
			),
		);
	};

	const runDeploymentPipeline = async () => {
		const initiallyApplied = Boolean(
			build &&
				(deploymentState?.last_deploy.image === build.image ||
					Boolean(deployment) ||
					updated),
		);
		setPipelineSteps(
			createDeploymentPipelineSteps(
				build,
				initiallyApplied,
				Boolean(deploymentState),
				t,
			),
		);
		setAction("pipeline");
		setError(null);
		setRuntime(null);
		let activeStage: DeploymentPipelineStage = "build";
		try {
			let activeBuild = build;
			if (!activeBuild) {
				updatePipelineStep("build", "active", t("deploy.startingRemoteBuild"));
				activeBuild = await executeRemoteBuild();
				updatePipelineStep("build", "complete", activeBuild.image);
			}

			activeStage = "deploy";
			let deploymentUrl = publicUrl;
			const buildApplied = Boolean(build && initiallyApplied);
			if (!buildApplied) {
				updatePipelineStep(
					"deploy",
					"active",
					deploymentState
						? t("deploy.updatingInstance")
						: t("deploy.submittingTemplate"),
				);
				deploymentUrl = await executeDeployment();
				updatePipelineStep("deploy", "complete", deploymentUrl);
			} else {
				updatePipelineStep(
					"deploy",
					"complete",
					deploymentUrl ?? t("deploy.currentImageDeployed"),
				);
			}

			activeStage = "verify";
			if (!deploymentUrl)
				throw new Error("The deployment does not have a public URL");
			updatePipelineStep("verify", "active", t("deploy.healthDescription"));
			const nextRuntime = await executeRuntimeVerification(deploymentUrl);
			if (!nextRuntime.ok) throw new Error(nextRuntime.detail);
			updatePipelineStep("verify", "complete", nextRuntime.detail);
		} catch (err) {
			const detail =
				err instanceof Error ? err.message : t("deploy.workflowFailed");
			updatePipelineStep(activeStage, "error", detail);
			setError(detail);
		} finally {
			setAction(null);
		}
	};

	return (
		<div className="h-full overflow-y-auto bg-background">
			<div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
				<header className="flex flex-col items-start gap-4 border-b pb-6 sm:flex-row sm:justify-between">
					<div>
						<div className="mb-2 flex items-center gap-2 text-sm font-medium text-muted-foreground">
							<CloudUploadIcon className="size-4" aria-hidden="true" />
							Sealos Cloud
						</div>
						<h1 className="text-2xl font-semibold">{t("deploy.webProject")}</h1>
						<p className="mt-2 text-sm text-muted-foreground">
							{t("deploy.description")}
						</p>
					</div>
					{result ? (
						<Badge variant={result.ready && build ? "default" : "secondary"}>
							{runtime?.ok
								? t("common.states.success")
								: deployment || updated
									? t("deploy.deployment")
									: build
										? t("deploy.ready")
										: t("settings.setup.title")}
						</Badge>
					) : null}
				</header>

				<section className="py-6">
					<label htmlFor="deploy-project" className="text-sm font-medium">
						{t("deploy.project")}
					</label>
					<div className="mt-2 flex flex-col gap-2 sm:flex-row">
						{projects.length > 0 ? (
							<select
								id="deploy-project"
								value={directory}
								onChange={(event) => {
									setDirectory(event.target.value);
									setResult(null);
									setBuild(null);
									setDeployment(null);
									setDeploymentState(null);
									setUpdated(false);
									setRuntime(null);
									setPipelineSteps([]);
								}}
								className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
							>
								{projects.map((project) => (
									<option key={project.directory} value={project.directory}>
										{project.name}
									</option>
								))}
							</select>
						) : (
							<Input
								id="deploy-project"
								value={directory}
								onChange={(event) => setDirectory(event.target.value)}
								placeholder="C:\\projects\\my-app"
							/>
						)}
						<Button
							className="w-full sm:w-auto"
							onClick={refresh}
							disabled={!directory || checking}
						>
							{checking ? (
								<Loader2Icon className="animate-spin" aria-hidden="true" />
							) : (
								<RefreshCwIcon aria-hidden="true" />
							)}
							{checking
								? t("common.states.checking")
								: t("deploy.checkReadiness")}
						</Button>
					</div>
					<p className="mt-2 truncate text-xs text-muted-foreground">
						{selectedProject?.directory ?? directory}
					</p>
				</section>

				{error ? (
					<Alert variant="destructive">
						<XCircleIcon aria-hidden="true" />
						<AlertTitle>{t("deploy.actionBlocked")}</AlertTitle>
						<AlertDescription>{error}</AlertDescription>
					</Alert>
				) : null}
				{loginCode ? (
					<Alert>
						<LogInIcon aria-hidden="true" />
						<AlertTitle>{t("deploy.authorize")}</AlertTitle>
						<AlertDescription>Confirmation code: {loginCode}</AlertDescription>
					</Alert>
				) : null}

				{result ? (
					<>
						<section className="border-t py-6">
							<h2 className="text-base font-semibold">
								1. {t("deploy.preflight")}
							</h2>
							<p className="mt-1 text-sm text-muted-foreground">
								{result.framework ?? t("common.ui.unknown")}
								{result.port ? ` - port ${result.port}` : ""}
							</p>
							<div className="mt-4 divide-y rounded-md border">
								{result.checks.map((check) => {
									const Icon = statusIcon(check.status);
									return (
										<div
											key={check.id}
											className="flex items-center gap-3 px-4 py-3"
										>
											<Icon
												className={
													check.status === "ready"
														? "size-4 text-green-600"
														: check.status === "warning"
															? "size-4 text-amber-500"
															: "size-4 text-destructive"
												}
												aria-hidden="true"
											/>
											<div className="min-w-0 flex-1">
												<p className="text-sm font-medium">{check.label}</p>
												<p className="text-xs text-muted-foreground">
													{check.detail}
												</p>
											</div>
										</div>
									);
								})}
							</div>
							{missingIds.has("container") && selectedProject ? (
								<div className="mt-4 flex flex-col sm:flex-row sm:justify-end">
									<Button
										className="w-full sm:w-auto"
										variant="outline"
										onClick={prepareWithAgent}
									>
										<SparklesIcon aria-hidden="true" />
										{t("deploy.prepareWithAgent")}
									</Button>
								</div>
							) : null}
						</section>

						<section className="border-t py-6">
							<h2 className="text-base font-semibold">
								2. {t("deploy.remoteBuild")}
							</h2>
							<p className="mt-1 text-sm text-muted-foreground">
								{t("deploy.remoteBuildDescription")}
							</p>
							{github ? (
								<div className="mt-4 flex items-start gap-3 border-l-2 pl-4">
									<GithubIcon className="mt-0.5 size-4" aria-hidden="true" />
									<div>
										<p className="text-sm font-medium">
											{github.repository ?? github.login ?? "GitHub"}
										</p>
										<p className="text-xs text-muted-foreground">
											{github.detail}
										</p>
									</div>
								</div>
							) : null}
							{buildProgress.length > 0 ? (
								<div className="mt-4 space-y-2">
									{buildProgress.map((progress) => (
										<div
											key={progress.stage}
											className="flex items-center gap-2 text-sm"
										>
											{progress.status === "complete" ? (
												<CheckCircle2Icon
													className="size-4 text-green-600"
													aria-hidden="true"
												/>
											) : (
												<Loader2Icon
													className="size-4 animate-spin"
													aria-hidden="true"
												/>
											)}
											<span className="min-w-0 flex-1 break-all">
												{progress.detail}
											</span>
										</div>
									))}
								</div>
							) : null}
							{build ? (
								<Alert className="mt-4">
									<CheckCircle2Icon
										className="text-green-600"
										aria-hidden="true"
									/>
									<AlertTitle>{t("deploy.imageReady")}</AlertTitle>
									<AlertDescription className="break-all">
										{build.image}
									</AlertDescription>
								</Alert>
							) : null}
							<div className="mt-4 flex flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
								{github && !github.authenticated ? (
									<Button
										className="w-full sm:w-auto"
										variant="outline"
										onClick={signInToGitHub}
										disabled={Boolean(action)}
									>
										<LogInIcon aria-hidden="true" />
										{action === "github-login"
											? t("deploy.waitingAuthorization")
											: t("deploy.signInGithub")}
									</Button>
								) : null}
								{github?.dockerfile && !github.workflow ? (
									<Button
										className="w-full sm:w-auto"
										variant="outline"
										onClick={prepareRemoteBuild}
										disabled={Boolean(action)}
									>
										<GithubIcon aria-hidden="true" />
										{t("deploy.prepareRemoteBuild")}
									</Button>
								) : null}
								{github?.workflow && !github.clean ? (
									<Button
										className="w-full sm:w-auto"
										variant="outline"
										onClick={publishSource}
										disabled={Boolean(action)}
									>
										<CloudUploadIcon aria-hidden="true" />
										{t("deploy.commitPush")}
									</Button>
								) : null}
								<Button
									className="w-full sm:w-auto"
									onClick={buildRemotely}
									disabled={!github?.ready || Boolean(action) || Boolean(build)}
								>
									<RocketIcon aria-hidden="true" />
									{action === "build"
										? t("deploy.buildingRemotely")
										: t("deploy.buildOnGithub")}
								</Button>
							</div>
						</section>

						<section className="border-t py-6">
							<h2 className="text-base font-semibold">
								3. {t("deploy.workspaceConfiguration")}
							</h2>
							{missingIds.has("auth") ? (
								<div className="mt-4 flex flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
									<select
										aria-label="Sealos region"
										value={region}
										onChange={(event) => setRegion(event.target.value)}
										className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm sm:w-auto"
									>
										{SEALOS_REGIONS.map((item) => (
											<option key={item.value} value={item.value}>
												{item.label}
											</option>
										))}
									</select>
									<Button
										className="w-full sm:w-auto"
										variant="outline"
										onClick={signInToSealos}
										disabled={Boolean(action)}
									>
										<LogInIcon aria-hidden="true" />
										{action === "sealos-login"
											? t("deploy.waitingAuthorization")
											: t("deploy.signInSealos")}
									</Button>
								</div>
							) : (
								<div className="mt-4 grid gap-4 sm:grid-cols-2">
									<div>
										<label
											htmlFor="sealos-region"
											className="text-sm font-medium"
										>
											{t("deploy.region")}
										</label>
										<Input
											id="sealos-region"
											value={result.region ?? region}
											disabled
											className="mt-2"
										/>
									</div>
									<div>
										<label
											htmlFor="sealos-workspace"
											className="text-sm font-medium"
										>
											{t("deploy.workspace")}
										</label>
										<select
											id="sealos-workspace"
											value={activeWorkspace?.id ?? ""}
											onChange={(event) => switchWorkspace(event.target.value)}
											disabled={action === "workspace"}
											className="mt-2 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
										>
											{workspaces.map((workspace) => (
												<option key={workspace.uid} value={workspace.id}>
													{workspace.id} - {workspace.teamName}
												</option>
											))}
										</select>
									</div>
								</div>
							)}
							{templateInputs.length > 0 ? (
								<div className="mt-5 grid gap-4 sm:grid-cols-2">
									{templateInputs.map((input) => (
										<div key={input.name}>
											<label
												htmlFor={`sealos-input-${input.name}`}
												className="text-sm font-medium"
											>
												{input.name}
												{input.required ? " *" : ""}
											</label>
											<Input
												id={`sealos-input-${input.name}`}
												type={input.sensitive ? "password" : "text"}
												value={inputValues[input.name] ?? ""}
												onChange={(event) =>
													setInputValues((current) => ({
														...current,
														[input.name]: event.target.value,
													}))
												}
												placeholder={input.defaultValue ?? input.description}
												className="mt-2"
											/>
											<p className="mt-1 text-xs text-muted-foreground">
												{input.description}
											</p>
										</div>
									))}
								</div>
							) : null}
						</section>

						<section className="border-t py-6">
							<h2 className="text-base font-semibold">
								4. {t("deploy.deploymentAndVerify")}
							</h2>
							<p className="mt-1 text-sm text-muted-foreground">
								{t("deploy.workflowDescription")}
								after a failure or app restart.
							</p>
							{pipelineSteps.length > 0 ? (
								<div className="mt-4 divide-y rounded-md border">
									{pipelineSteps.map((step) => (
										<div
											key={step.id}
											className="flex items-start gap-3 px-4 py-3"
										>
											{step.status === "complete" ? (
												<CheckCircle2Icon
													className="mt-0.5 size-4 shrink-0 text-green-600"
													aria-hidden="true"
												/>
											) : step.status === "active" ? (
												<Loader2Icon
													className="mt-0.5 size-4 shrink-0 animate-spin"
													aria-hidden="true"
												/>
											) : step.status === "error" ? (
												<XCircleIcon
													className="mt-0.5 size-4 shrink-0 text-destructive"
													aria-hidden="true"
												/>
											) : (
												<CircleIcon
													className="mt-0.5 size-4 shrink-0 text-muted-foreground"
													aria-hidden="true"
												/>
											)}
											<div className="min-w-0 flex-1">
												<p className="text-sm font-medium">{step.label}</p>
												<p className="break-all text-xs text-muted-foreground">
													{step.detail}
												</p>
											</div>
										</div>
									))}
								</div>
							) : null}
							<div className="mt-4 flex flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
								<Button
									className="w-full sm:w-auto"
									disabled={
										!result.ready ||
										(!build && !github?.ready) ||
										!requiredInputsReady ||
										Boolean(action) ||
										Boolean(runtime?.ok)
									}
									onClick={runDeploymentPipeline}
								>
									<RocketIcon aria-hidden="true" />
									{action === "pipeline"
										? (activePipelineStep?.label ??
											t("deploy.startingDeployment"))
										: runtime?.ok
											? t("deploy.deploymentVerified")
											: pipelineHasError
												? t("deploy.retryFailedStage")
												: build
													? t("deploy.deployAndVerify")
													: t("deploy.buildDeployVerify")}
								</Button>
							</div>
							{deployment ? (
								<Alert className="mt-4 border-green-600/30">
									<CheckCircle2Icon
										className="text-green-600"
										aria-hidden="true"
									/>
									<AlertTitle>{t("deploy.submitted")}</AlertTitle>
									<AlertDescription>
										Instance {deployment.instanceName ?? "created"} in{" "}
										{deployment.region}. Log: {deployment.logPath}
									</AlertDescription>
								</Alert>
							) : null}
							{updated && deploymentState ? (
								<Alert className="mt-4 border-green-600/30">
									<CheckCircle2Icon
										className="text-green-600"
										aria-hidden="true"
									/>
									<AlertTitle>{t("deploy.updated")}</AlertTitle>
									<AlertDescription className="break-all">
										{deploymentState.last_deploy.image}
									</AlertDescription>
								</Alert>
							) : null}
							{publicUrl ? (
								<div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
									<Button
										className="w-full sm:w-auto"
										onClick={() =>
											window.open(publicUrl, "_blank", "noopener,noreferrer")
										}
									>
										<ExternalLinkIcon aria-hidden="true" />
										{t("deploy.openAddress")}
									</Button>
								</div>
							) : null}
							{runtime ? (
								<div className="mt-4 divide-y rounded-md border">
									{runtime.checks.map((check) => (
										<div
											key={check.id}
											className="flex items-center gap-3 px-4 py-3"
										>
											{check.ok ? (
												<CheckCircle2Icon
													className="size-4 text-green-600"
													aria-hidden="true"
												/>
											) : (
												<XCircleIcon
													className="size-4 text-destructive"
													aria-hidden="true"
												/>
											)}
											<span className="text-sm">{check.detail}</span>
										</div>
									))}
								</div>
							) : null}
						</section>
					</>
				) : null}
			</div>
		</div>
	);
}
