import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, it } from "node:test"
import {
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
		await updateSealosTemplateImage(root, image)
		assert.match(await readFile(file, "utf8"), new RegExp(image))
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
})
