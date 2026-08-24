const { describe, expect, it } = require("bun:test")
const { decideRelease, parseArguments } = require("./decide-release.cjs")

describe("release workflow decision", () => {
	it("stops after creating or updating a version PR", () => {
		expect(
			decideRelease({
				published: false,
				hasChangesets: true,
				rebuildCurrent: false,
				tagExists: false,
			}),
		).toEqual({
			shouldRelease: false,
			reason: "version-pr-created-or-updated",
		})
	})

	it("releases a merged version whose product tag does not exist", () => {
		expect(
			decideRelease({
				published: false,
				hasChangesets: false,
				rebuildCurrent: false,
				tagExists: false,
			}),
		).toEqual({ shouldRelease: true, reason: "unreleased-version" })
	})

	it("allows an explicit rebuild only when no version PR was produced", () => {
		expect(
			decideRelease({
				published: false,
				hasChangesets: false,
				rebuildCurrent: true,
				tagExists: true,
			}),
		).toEqual({ shouldRelease: true, reason: "explicit-rebuild" })
		expect(
			decideRelease({
				published: false,
				hasChangesets: true,
				rebuildCurrent: true,
				tagExists: true,
			}).shouldRelease,
		).toBe(false)
	})

	it("does not rebuild an existing tag without an explicit request", () => {
		expect(
			decideRelease({
				published: false,
				hasChangesets: false,
				rebuildCurrent: false,
				tagExists: true,
			}),
		).toEqual({ shouldRelease: false, reason: "version-already-released" })
	})

	it("parses only explicit boolean arguments", () => {
		expect(
			parseArguments([
				"--published",
				"false",
				"--has-changesets",
				"true",
				"--rebuild-current",
				"false",
				"--tag-exists",
				"false",
			]),
		).toEqual({
			published: false,
			hasChangesets: true,
			rebuildCurrent: false,
			tagExists: false,
			githubOutput: null,
		})
		expect(() =>
			parseArguments([
				"--published",
				"yes",
				"--has-changesets",
				"false",
				"--rebuild-current",
				"false",
				"--tag-exists",
				"false",
			]),
		).toThrow("--published must be true or false")
	})
})
