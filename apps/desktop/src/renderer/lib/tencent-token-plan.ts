/**
 * Applies Tencent Token Plan to OpenCode while keeping its API key in auth.json.
 */

import { getBaseClient } from "../services/connection-manager";
import {
	createTencentTokenPlanProviderConfig,
	TENCENT_TOKEN_PLAN_PROVIDER_ID,
	updateTencentTokenPlanProviderLists,
} from "./tencent-token-plan-provider-config";

type BaseClient = NonNullable<ReturnType<typeof getBaseClient>>;

export async function applyTencentTokenPlanProvider(
	client: BaseClient,
	apiKey: string,
): Promise<void> {
	const current = await client.global.config.get();
	if (!current.data) throw new Error("OpenCode configuration is unavailable");

	await client.auth.set({
		providerID: TENCENT_TOKEN_PLAN_PROVIDER_ID,
		auth: { type: "api", key: apiKey },
	});

	try {
		const result = await client.global.config.update({
			config: {
				...updateTencentTokenPlanProviderLists(current.data, true),
				provider: {
					[TENCENT_TOKEN_PLAN_PROVIDER_ID]:
						createTencentTokenPlanProviderConfig(),
				},
			},
		});
		if (result.error)
			throw new Error("OpenCode rejected the Tencent Token Plan configuration");
	} catch (error) {
		await client.auth
			.remove({ providerID: TENCENT_TOKEN_PLAN_PROVIDER_ID })
			.catch(() => undefined);
		throw error;
	}
}

export async function disableTencentTokenPlanProvider(
	client: BaseClient,
): Promise<void> {
	const current = await client.global.config.get();
	if (current.data) {
		const result = await client.global.config.update({
			config: updateTencentTokenPlanProviderLists(current.data, false),
		});
		if (result.error)
			throw new Error("OpenCode rejected the Tencent Token Plan provider update");
	}
	await client.auth.remove({ providerID: TENCENT_TOKEN_PLAN_PROVIDER_ID });
}
