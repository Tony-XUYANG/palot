import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, it } from "node:test"
import {
	createSealosLaunchpadUrl,
	isDirectSealosHost,
	isTransientFetchError,
	isTransientKubectlError,
	isSealosClusterStable,
	readSealosTemplateInputs,
	updateSealosTemplateImage,
} from "./sealos-service.ts"

const roots: string[] = []

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function createTemplate(): Promise<{ root: string; file: string }> {
	const root = await mkdtemp(path.join(os.tmpdir(), "palot-sealos-test-"))
	roots.push(root)
	const file = path.join(root, ".sealos", "template", "index.yaml")
	await mkdir(path.dirname(file), { recursive: true })
	await writeFile(
		file,
		`apiVersion: app.sealos.io/v1
kind: Template
metadata:
  name: demo
spec:
  inputs:
    ADMIN_PASSWORD:
      description: Administrator password
      type: string
      required: true
    LOG_LEVEL:
      description: Log level
      type: string
      required: false
      default: info
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: demo
spec:
  template:
    spec:
      containers:
        - name: demo
          image: example.invalid/demo:old
`,
		"utf8",
	)
	return { root, file }
}

describe("Sealos template helpers", () => {
	it("builds the Launchpad API URL from the authenticated region", () => {
		assert.equal(
			createSealosLaunchpadUrl("https://hzh.sealos.run", "demo-app").href,
			"https://applaunchpad.hzh.sealos.run/api/getAppByAppName?appName=demo-app",
		)
	})

	it("bypasses system proxies only for official Sealos domains", () => {
		assert.equal(isDirectSealosHost("hzh.sealos.run"), true)
		assert.equal(isDirectSealosHost("palot-acceptance.sealoshzh.site"), true)
		assert.equal(isDirectSealosHost("sealos.run.attacker.example"), false)
		assert.equal(isDirectSealosHost("custom.example.com"), false)
	})

	it("extracts required, defaulted, and sensitive inputs", async () => {
		const { root } = await createTemplate()
		const inputs = await readSealosTemplateInputs(root)
		assert.deepEqual(inputs, [
			{
				name: "ADMIN_PASSWORD",
				description: "Administrator password",
				required: true,
				defaultValue: null,
				sensitive: true,
			},
			{
				name: "LOG_LEVEL",
				description: "Log level",
				required: false,
				defaultValue: "info",
				sensitive: false,
			},
		])
	})

	it("writes an immutable GHCR image into the application deployment", async () => {
		const { root, file } = await createTemplate()
		const image = `ghcr.io/owner/demo@sha256:${"a".repeat(64)}`
		const original = await readFile(file, "utf8")
		await writeFile(file, original.replace("---\n", "---\n---\n"), "utf8")
		await updateSealosTemplateImage(root, image)
		await updateSealosTemplateImage(root, image)
		const template = await readFile(file, "utf8")
		assert.match(template, new RegExp(image))
		assert.equal(template.match(/^---$/gm)?.length, 1)
	})

	it("rejects mutable image references", async () => {
		const { root } = await createTemplate()
		await assert.rejects(updateSealosTemplateImage(root, "ghcr.io/owner/demo:latest"))
	})

	it("requires stable pod identity and restart counts across the runtime window", () => {
		const baseline = {
			deploymentReady: true,
			podsReady: true,
			endpointsReady: true,
			ingressReady: true,
			podUids: ["pod-a"],
			restarts: { "pod-a/web": 0 },
			severeLogCount: 0,
		}
		assert.equal(isSealosClusterStable(baseline, { ...baseline }), true)
		assert.equal(
			isSealosClusterStable(baseline, {
				...baseline,
				restarts: { "pod-a/web": 1 },
			}),
			false,
		)
		assert.equal(isSealosClusterStable(baseline, { ...baseline, podUids: ["pod-b"] }), false)
	})

	it("retries only transient kubectl transport failures", () => {
		assert.equal(
			isTransientKubectlError({ stderr: "Unable to connect: net/http: TLS handshake timeout" }),
			true,
		)
		assert.equal(isTransientKubectlError(new Error("connection reset by peer")), true)
		assert.equal(isTransientKubectlError({ stderr: "Error from server (Forbidden)" }), false)
	})

	it("retries only transient HTTP transport failures", () => {
		assert.equal(isTransientFetchError(new TypeError("fetch failed")), true)
		assert.equal(isTransientFetchError(new Error("socket closed during TLS handshake")), true)
		assert.equal(isTransientFetchError(new Error("net::ERR_CONNECTION_CLOSED")), true)
		assert.equal(isTransientFetchError(new Error("Sealos returned HTTP 403")), false)
	})
})
