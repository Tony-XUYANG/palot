import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Config } from "@opencode-ai/sdk/v2/client";
import {
	applyTencentTokenPlanProvider,
	disableTencentTokenPlanProvider,
} from "./tencent-token-plan.ts";
import { TENCENT_TOKEN_PLAN_PROVIDER_ID } from "./tencent-token-plan-provider-config.ts";

type TokenPlanClient = Parameters<typeof applyTencentTokenPlanProvider>[0];

function createClient({
	config = {},
	updateError = false,
}: {
	config?: Config;
	updateError?: boolean;
} = {}) {
	const authSetCalls: unknown[] = [];
	const authRemoveCalls: unknown[] = [];
	const configUpdateCalls: unknown[] = [];
	const operations: string[] = [];
	const client = {
		auth: {
			set: async (input: unknown) => {
				authSetCalls.push(input);
				return {};
			},
			remove: async (input: unknown) => {
				operations.push("auth.remove");
				authRemoveCalls.push(input);
				return {};
			},
		},
		global: {
			config: {
				get: async () => ({ data: config }),
				update: async (input: unknown) => {
					operations.push("config.update");
					configUpdateCalls.push(input);
					return updateError ? { error: { message: "rejected" } } : {};
				},
		},
		},
	} as unknown as TokenPlanClient;

	return {
		client,
		authSetCalls,
		authRemoveCalls,
		configUpdateCalls,
		operations,
	};
}

describe("Tencent Token Plan credential lifecycle", () => {
	it("stores the API key in auth while keeping it out of provider config", async () => {
		const { client, authSetCalls, configUpdateCalls } = createClient();
		await applyTencentTokenPlanProvider(client, "token-plan-secret");

		assert.deepEqual(authSetCalls, [
			{
				providerID: TENCENT_TOKEN_PLAN_PROVIDER_ID,
				auth: { type: "api", key: "token-plan-secret" },
			},
		]);
		assert.equal(configUpdateCalls.length, 1);
		assert.equal(
			JSON.stringify(configUpdateCalls[0]).includes("token-plan-secret"),
			false,
		);
	});

	it("rolls back the stored credential when OpenCode rejects the config", async () => {
		const { client, authRemoveCalls } = createClient({ updateError: true });
		await assert.rejects(
			applyTencentTokenPlanProvider(client, "token-plan-secret"),
			/OpenCode rejected/,
		);
		assert.deepEqual(authRemoveCalls, [
			{ providerID: TENCENT_TOKEN_PLAN_PROVIDER_ID },
		]);
	});

	it("removes auth and disables the provider on disconnect", async () => {
		const { client, authRemoveCalls, configUpdateCalls, operations } =
			createClient();
		await disableTencentTokenPlanProvider(client);

		assert.deepEqual(authRemoveCalls, [
			{ providerID: TENCENT_TOKEN_PLAN_PROVIDER_ID },
		]);
		assert.deepEqual(configUpdateCalls, [
			{
				config: {
					disabled_providers: [TENCENT_TOKEN_PLAN_PROVIDER_ID],
				},
			},
		]);
		assert.deepEqual(operations, ["config.update", "auth.remove"]);
	});
});
