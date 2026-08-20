/**
 * Applies the main-process Palot Cloud loopback setup to OpenCode without exposing the cloud token.
 */

import type { PalotCloudProviderSetup } from "../../preload/api";
import { getBaseClient } from "../services/connection-manager";
import {
	createPalotCloudProviderConfig,
	PALOT_CLOUD_PROVIDER_ID,
	updatePalotCloudProviderLists,
} from "./palot-cloud-provider-config";

export { PALOT_CLOUD_PROVIDER_ID } from "./palot-cloud-provider-config";

export async function applyPalotCloudProvider(
	setup: PalotCloudProviderSetup,
): Promise<void> {
	const client = getBaseClient();
	if (!client) throw new Error("OpenCode is not connected");
	const current = await client.global.config.get();
	if (!current.data) throw new Error("OpenCode configuration is unavailable");
	const result = await client.global.config.update({
		config: {
			...updatePalotCloudProviderLists(current.data, true),
			provider: {
				[PALOT_CLOUD_PROVIDER_ID]: createPalotCloudProviderConfig(setup),
			},
		},
	});
	if (result.error)
		throw new Error("OpenCode rejected the Palot Cloud provider configuration");
	await client.global.dispose();
}

export async function disablePalotCloudProvider(): Promise<void> {
	const client = getBaseClient();
	if (!client) return;
	const current = await client.global.config.get();
	if (!current.data) return;
	const result = await client.global.config.update({
		config: updatePalotCloudProviderLists(current.data, false),
	});
	if (result.error)
		throw new Error("OpenCode rejected the Palot Cloud provider update");
	await client.global.dispose();
}
