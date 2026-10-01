/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import type { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { AuthProviderLogger } from '../authProviderLogger';
import type { CredentialChainConfig } from '../authProvider';

type ChainInit = Parameters<typeof fromNodeProviderChain>[0];
type CreateChain = (init: ChainInit) => ReturnType<typeof fromNodeProviderChain>;

const DEFAULT_AWS_REGION = 'us-east-1';

const logger = new AuthProviderLogger('AWS');

/**
 * Resolve the init object for `fromNodeProviderChain` from the provider
 * catalog's `connection.aws` slice, and log the resolved region and profile.
 *
 * The region and profile come only from the catalog; the `AWS_PROFILE` /
 * `AWS_REGION` env vars reach this function through the catalog's env source,
 * not directly. The region is passed to the STS `clientConfig` only for
 * web-identity auth (`AWS_WEB_IDENTITY_TOKEN_FILE` set), so the STS exchange
 * targets the configured region. SSO profiles read the region from `sso_region`
 * in `~/.aws/config`, which `clientConfig` must not override.
 */
export function resolveAwsChainInit(
	aws: { profile?: string; region?: string } | undefined,
	env: NodeJS.ProcessEnv,
): ChainInit {
	const profile = aws?.profile;
	const region = aws?.region ?? DEFAULT_AWS_REGION;

	const chainInit: ChainInit = {
		...(profile ? { profile } : {}),
		...(env.AWS_WEB_IDENTITY_TOKEN_FILE ? { clientConfig: { region } } : {}),
	};

	logger.info(
		`Credential chain initialized ` +
		`(region=${region}, profile=${profile ?? '(default)'})`
	);

	return chainInit;
}

/**
 * Build the credential chain config for the AWS (Bedrock) auth provider.
 *
 * `getAws` reads the catalog's `connection.aws` slice at resolve time so a
 * changed profile or region applies to the next resolution. `createChain` is
 * `fromNodeProviderChain` in production; tests pass a fake so no request
 * reaches AWS.
 *
 * With web-identity auth (`AWS_WEB_IDENTITY_TOKEN_FILE` set), the token file
 * can appear after activation: on Posit Workbench the session agent writes it
 * asynchronously, so the startup resolve may fail with ENOENT (#15292).
 * `shouldRefresh` retries a failed resolve once the token file exists, and
 * again each time it is rewritten, but never while credentials are held:
 * every STS exchange yields new credentials, so re-resolving a healthy
 * session on each rewrite would report a changed session every few minutes.
 * Expiring credentials are refreshed through their expiration instead.
 */
export function createAwsCredentialChain(
	getAws: () => { profile?: string; region?: string } | undefined,
	env: NodeJS.ProcessEnv,
	createChain: CreateChain,
): CredentialChainConfig {
	const tokenFile = env.AWS_WEB_IDENTITY_TOKEN_FILE;
	let credentialsHeld = false;
	// Token file mtime seen by the last resolve; undefined if it was missing.
	let attemptedMtime: number | undefined;

	return {
		resolve: async () => {
			if (tokenFile) {
				attemptedMtime = await getMtime(tokenFile);
			}
			try {
				const credentialProvider = createChain(resolveAwsChainInit(getAws(), env));
				const resolved = await credentialProvider();
				credentialsHeld = true;
				return {
					token: JSON.stringify({
						accessKeyId: resolved.accessKeyId,
						secretAccessKey: resolved.secretAccessKey,
						sessionToken: resolved.sessionToken,
					}),
					expiration: resolved.expiration,
				};
			} catch (err) {
				credentialsHeld = false;
				throw err;
			}
		},
		shouldRefresh: async () => {
			if (!tokenFile || credentialsHeld) {
				return false;
			}
			const mtime = await getMtime(tokenFile);
			return mtime !== undefined &&
				(attemptedMtime === undefined || mtime > attemptedMtime);
		},
	};
}

/**
 * Watch the web-identity token file and call `resolve` when `shouldRefresh`
 * says a retry is due. `shouldRefresh` alone only runs when a consumer calls
 * `getSessions`, and a consumer that waits for a session event would never
 * make that call (#15292); resolving here fires the `added` event instead.
 *
 * Uses fs.watchFile rather than createFileSystemWatcher: the latter misses
 * the file's creation when its folder does not exist yet, and its fallback
 * for a missing path is this same stat polling. Returns undefined when
 * web-identity auth is not in use.
 */
export function watchWebIdentityTokenFile(
	env: NodeJS.ProcessEnv,
	credentialChain: CredentialChainConfig,
	resolve: () => Promise<unknown>,
	intervalMs = 5000,
): { dispose(): void } | undefined {
	const tokenFile = env.AWS_WEB_IDENTITY_TOKEN_FILE;
	if (!tokenFile) {
		return undefined;
	}
	const onTokenFile = async () => {
		if (await credentialChain.shouldRefresh?.()) {
			await resolve();
		}
	};
	fs.watchFile(tokenFile, { persistent: false, interval: intervalMs }, onTokenFile);
	return { dispose: () => fs.unwatchFile(tokenFile, onTokenFile) };
}

async function getMtime(file: string): Promise<number | undefined> {
	try {
		return (await fs.promises.stat(file)).mtime.getTime();
	} catch {
		return undefined;
	}
}
