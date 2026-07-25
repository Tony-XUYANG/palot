import { Alert, AlertDescription, AlertTitle } from "@palot/ui/components/alert"
import { Badge } from "@palot/ui/components/badge"
import { Button } from "@palot/ui/components/button"
import { Input } from "@palot/ui/components/input"
import { useNavigate } from "@tanstack/react-router"
import {
	CheckCircle2Icon,
	CloudUploadIcon,
	ExternalLinkIcon,
	Loader2Icon,
	LogInIcon,
	RefreshCwIcon,
	SparklesIcon,
	TriangleAlertIcon,
	XCircleIcon,
} from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import type {
	SealosDeployResult,
	SealosPreflightResult,
	SealosRuntimeResult,
} from "../../preload/api"
import { setDraftAtom } from "../atoms/preferences"
import { appStore } from "../atoms/store"
import { useProjectList } from "../hooks/use-agents"
import { NEW_CHAT_DRAFT_KEY } from "../hooks/use-draft"

const SEALOS_REGIONS = [
	{ value: "https://gzg.sealos.run", label: "Guangzhou" },
	{ value: "https://bja.sealos.run", label: "Beijing" },
	{ value: "https://hzh.sealos.run", label: "Hangzhou" },
	{ value: "https://usw-1.sealos.io", label: "US West" },
]

const PREPARE_DEPLOYMENT_PROMPT = `Prepare this web project for deployment to Sealos Cloud.

1. Analyze the real build, start command, listening host, port, environment variables, migrations, storage, and external services.
2. If needed, create a production multi-stage Dockerfile and a workspace-aware .dockerignore. Use a non-root runtime where compatible, bind to 0.0.0.0, and use pinned versions.
3. Build the linux/amd64 image and validate that the container starts and its HTTP endpoint responds. Fix failures instead of stopping after the first build.
4. Generate .sealos/template/index.yaml using the current Sealos Template CR format. Include Deployment, Service, root Ingress, and App resources with consistent app labels and names. Use IfNotPresent, limits cpu=200m and memory=256Mi, requests cpu=20m and memory=25Mi, revisionHistoryLimit 1, and automountServiceAccountToken false unless the app requires Kubernetes API access.
5. Do not use floating image tags, emptyDir, raw database Deployments, or expose secrets in generated files. Use KubeBlocks resources for databases.
6. Validate the generated template and summarize required user inputs. Do not deploy yet; stop when the project is ready for review.`

export function SealosDeployPage() {
	const navigate = useNavigate()
	const projects = useProjectList()
	const [directory, setDirectory] = useState("")
	const [region, setRegion] = useState(SEALOS_REGIONS[0].value)
	const [result, setResult] = useState<SealosPreflightResult | null>(null)
	const [deployment, setDeployment] = useState<SealosDeployResult | null>(null)
	const [runtime, setRuntime] = useState<SealosRuntimeResult | null>(null)
	const [checking, setChecking] = useState(false)
	const [deploying, setDeploying] = useState(false)
	const [signingIn, setSigningIn] = useState(false)
	const [verifying, setVerifying] = useState(false)
	const [loginCode, setLoginCode] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		if (!directory && projects[0]?.directory) setDirectory(projects[0].directory)
	}, [directory, projects])

	const selectedProject = useMemo(
		() => projects.find((project) => project.directory === directory),
		[projects, directory],
	)
	const missingIds = useMemo(
		() => new Set(result?.checks.filter((check) => check.status === "missing").map((check) => check.id)),
		[result],
	)

	const runChecks = async () => {
		if (!directory || !("palot" in window)) return
		setChecking(true)
		setError(null)
		try {
			setResult(await window.palot.sealos.preflight(directory))
		} catch (err) {
			setError(err instanceof Error ? err.message : "Deployment checks failed")
		} finally {
			setChecking(false)
		}
	}

	const signIn = async () => {
		if (!("palot" in window)) return
		setSigningIn(true)
		setError(null)
		try {
			const login = await window.palot.sealos.startLogin(region)
			setLoginCode(login.userCode)
			await window.palot.sealos.completeLogin(login.sessionId)
			setLoginCode(null)
			if (directory) setResult(await window.palot.sealos.preflight(directory))
		} catch (err) {
			setError(err instanceof Error ? err.message : "Sealos sign-in failed")
		} finally {
			setSigningIn(false)
		}
	}

	const prepareWithAgent = () => {
		if (!selectedProject) return
		appStore.set(setDraftAtom, { key: NEW_CHAT_DRAFT_KEY, text: PREPARE_DEPLOYMENT_PROMPT })
		navigate({
			to: "/project/$projectSlug",
			params: { projectSlug: selectedProject.slug },
		})
	}

	const deploy = async () => {
		if (!directory || !result?.ready || !("palot" in window)) return
		setDeploying(true)
		setError(null)
		try {
			setDeployment(await window.palot.sealos.deploy(directory))
		} catch (err) {
			setError(err instanceof Error ? err.message : "Deployment failed")
		} finally {
			setDeploying(false)
		}
	}

	const verifyRuntime = async () => {
		if (!deployment?.appUrl || !("palot" in window)) return
		setVerifying(true)
		setError(null)
		try {
			setRuntime(await window.palot.sealos.verifyRuntime(deployment.appUrl))
		} catch (err) {
			setError(err instanceof Error ? err.message : "Runtime verification failed")
		} finally {
			setVerifying(false)
		}
	}

	return (
		<div className="h-full overflow-y-auto bg-background">
			<div className="mx-auto w-full max-w-4xl px-6 py-8">
				<header className="flex items-start justify-between gap-4 border-b pb-6">
					<div>
						<div className="mb-2 flex items-center gap-2 text-sm font-medium text-muted-foreground">
							<CloudUploadIcon className="size-4" />
							Sealos Cloud
						</div>
						<h1 className="text-2xl font-semibold">Deploy a web project</h1>
						<p className="mt-2 text-sm text-muted-foreground">
							Prepare, validate, and publish the selected project.
						</p>
					</div>
					{result ? (
						<Badge variant={result.ready ? "default" : "secondary"}>
							{result.ready ? "Ready" : "Action required"}
						</Badge>
					) : null}
				</header>

				<section className="py-6">
					<label htmlFor="deploy-project" className="text-sm font-medium">
						Project
					</label>
					<div className="mt-2 flex gap-2">
						{projects.length > 0 ? (
							<select
								id="deploy-project"
								value={directory}
								onChange={(event) => {
									setDirectory(event.target.value)
									setResult(null)
									setDeployment(null)
									setRuntime(null)
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
						<Button onClick={runChecks} disabled={!directory || checking}>
							{checking ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}
							{checking ? "Checking" : "Check readiness"}
						</Button>
					</div>
					<p className="mt-2 truncate text-xs text-muted-foreground">
						{selectedProject?.directory ?? directory}
					</p>
				</section>

				{error ? (
					<Alert variant="destructive">
						<XCircleIcon />
						<AlertTitle>Deployment blocked</AlertTitle>
						<AlertDescription>{error}</AlertDescription>
					</Alert>
				) : null}

				{loginCode ? (
					<Alert>
						<LogInIcon />
						<AlertTitle>Authorize Sealos in your browser</AlertTitle>
						<AlertDescription>Confirmation code: {loginCode}</AlertDescription>
					</Alert>
				) : null}

				{result ? (
					<section className="border-t py-6">
						<div className="mb-4">
							<h2 className="text-base font-semibold">Deployment readiness</h2>
							<p className="mt-1 text-sm text-muted-foreground">
								{result.framework ?? "Unknown framework"}
								{result.port ? ` - port ${result.port}` : ""}
							</p>
						</div>
						<div className="divide-y rounded-md border">
							{result.checks.map((check) => {
								const Icon =
									check.status === "ready"
										? CheckCircle2Icon
										: check.status === "warning"
											? TriangleAlertIcon
											: XCircleIcon
								return (
									<div key={check.id} className="flex items-center gap-3 px-4 py-3">
										<Icon
											className={
												check.status === "ready"
													? "size-4 text-green-600"
													: check.status === "warning"
														? "size-4 text-amber-500"
														: "size-4 text-destructive"
											}
										/>
										<div className="min-w-0 flex-1">
											<p className="text-sm font-medium">{check.label}</p>
											<p className="text-xs text-muted-foreground">{check.detail}</p>
										</div>
									</div>
								)
							})}
						</div>

						<div className="mt-6 flex flex-wrap items-center justify-end gap-2">
							{missingIds.has("auth") ? (
								<>
									<select
										aria-label="Sealos region"
										value={region}
										onChange={(event) => setRegion(event.target.value)}
										className="h-9 rounded-md border border-input bg-background px-3 text-sm"
									>
										{SEALOS_REGIONS.map((item) => (
											<option key={item.value} value={item.value}>
												{item.label}
											</option>
										))}
									</select>
									<Button variant="outline" onClick={signIn} disabled={signingIn}>
										{signingIn ? <Loader2Icon className="animate-spin" /> : <LogInIcon />}
										{signingIn ? "Waiting for authorization" : "Sign in to Sealos"}
									</Button>
								</>
							) : null}
							{missingIds.has("container") && selectedProject ? (
								<Button variant="outline" onClick={prepareWithAgent}>
									<SparklesIcon />
									Prepare with Agent
								</Button>
							) : null}
							<Button disabled={!result.ready || deploying || Boolean(deployment)} onClick={deploy}>
								{deploying ? <Loader2Icon className="animate-spin" /> : <CloudUploadIcon />}
								{deploying ? "Deploying" : deployment ? "Deployed" : "Deploy to Sealos"}
							</Button>
						</div>
					</section>
				) : null}

				{deployment ? (
					<section className="border-t py-6">
						<Alert className="border-green-600/30">
							<CheckCircle2Icon className="text-green-600" />
							<AlertTitle>Deployment submitted</AlertTitle>
							<AlertDescription>
								Template accepted in {deployment.region}. Log: {deployment.logPath}
							</AlertDescription>
						</Alert>
						<div className="mt-4 flex justify-end gap-2">
							{deployment.appUrl ? (
								<>
									<Button variant="outline" onClick={verifyRuntime} disabled={verifying}>
										{verifying ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}
										Verify runtime
									</Button>
									<Button
										render={<a href={deployment.appUrl} target="_blank" rel="noreferrer" />}
									>
										<ExternalLinkIcon />
										Open app
									</Button>
								</>
							) : null}
						</div>
						{runtime ? (
							<p className={`mt-3 text-sm ${runtime.ok ? "text-green-600" : "text-destructive"}`}>
								{runtime.detail}
								{runtime.status ? ` (HTTP ${runtime.status})` : ""}
							</p>
						) : null}
					</section>
				) : null}
			</div>
		</div>
	)
}
