const { afterEach, describe, expect, it } = require("bun:test")
const { validateWindowsSigningConfig } = require("./validate-windows-signing-config.cjs")

const SIGNING_ENVIRONMENT_NAMES = [
	"WINDOWS_SIGNING_MODE",
	"WINDOWS_SIGNING_PUBLISHER",
	"WINDOWS_CSC_LINK",
	"SSL_COM_USERNAME",
	"SSL_COM_PASSWORD",
	"SSL_COM_TOTP_SECRET",
]

const originalEnvironment = Object.fromEntries(
	SIGNING_ENVIRONMENT_NAMES.map((name) => [name, process.env[name]]),
)

afterEach(() => {
	for (const name of SIGNING_ENVIRONMENT_NAMES) {
		const value = originalEnvironment[name]
		if (value === undefined) {
			delete process.env[name]
		} else {
			process.env[name] = value
		}
	}
})

function setSigningEnvironment(values = {}) {
	for (const name of SIGNING_ENVIRONMENT_NAMES) {
		delete process.env[name]
	}
	Object.assign(process.env, values)
}

describe("Windows signing configuration", () => {
	it("allows unsigned alpha and beta previews", () => {
		setSigningEnvironment()
		expect(validateWindowsSigningConfig("0.12.0-beta.7")).toEqual({
			mode: "unsigned",
			allowsUnsignedPreview: true,
		})
	})

	it("rejects unsigned RC and stable releases", () => {
		setSigningEnvironment()
		expect(() => validateWindowsSigningConfig("0.12.0-rc.1")).toThrow(
			"require WINDOWS_SIGNING_MODE",
		)
		expect(() => validateWindowsSigningConfig("0.12.0")).toThrow(
			"require WINDOWS_SIGNING_MODE",
		)
	})

	it("accepts a complete PFX configuration", () => {
		setSigningEnvironment({
			WINDOWS_SIGNING_MODE: "pfx",
			WINDOWS_SIGNING_PUBLISHER: "CN=Palot Publisher",
			WINDOWS_CSC_LINK: "base64-pfx",
		})
		expect(validateWindowsSigningConfig("0.12.0-rc.1").mode).toBe("pfx")
	})

	it("requires a PFX source", () => {
		setSigningEnvironment({
			WINDOWS_SIGNING_MODE: "pfx",
			WINDOWS_SIGNING_PUBLISHER: "CN=Palot Publisher",
		})
		expect(() => validateWindowsSigningConfig("0.12.0-rc.1")).toThrow(
			"WINDOWS_CSC_LINK",
		)
	})

	it("accepts a complete SSL.com eSigner configuration", () => {
		setSigningEnvironment({
			WINDOWS_SIGNING_MODE: "sslcom-esigner",
			WINDOWS_SIGNING_PUBLISHER: "CN=Palot Publisher",
			SSL_COM_USERNAME: "publisher@example.com",
			SSL_COM_PASSWORD: "secret",
			SSL_COM_TOTP_SECRET: "totp-secret",
		})
		expect(validateWindowsSigningConfig("0.12.0").mode).toBe("sslcom-esigner")
	})

	it("requires every SSL.com credential without exposing its value", () => {
		setSigningEnvironment({
			WINDOWS_SIGNING_MODE: "sslcom-esigner",
			WINDOWS_SIGNING_PUBLISHER: "CN=Palot Publisher",
			SSL_COM_USERNAME: "publisher@example.com",
			SSL_COM_PASSWORD: "secret",
		})
		expect(() => validateWindowsSigningConfig("0.12.0")).toThrow(
			"SSL_COM_TOTP_SECRET",
		)
	})

	it("rejects signing without the exact publisher subject", () => {
		setSigningEnvironment({
			WINDOWS_SIGNING_MODE: "sslcom-esigner",
			SSL_COM_USERNAME: "publisher@example.com",
			SSL_COM_PASSWORD: "secret",
			SSL_COM_TOTP_SECRET: "totp-secret",
		})
		expect(() => validateWindowsSigningConfig("0.12.0-beta.7")).toThrow(
			"WINDOWS_SIGNING_PUBLISHER",
		)
	})

	it("rejects unknown signing modes", () => {
		setSigningEnvironment({ WINDOWS_SIGNING_MODE: "automatic" })
		expect(() => validateWindowsSigningConfig("0.12.0-beta.7")).toThrow(
			"Unsupported WINDOWS_SIGNING_MODE",
		)
	})
})
