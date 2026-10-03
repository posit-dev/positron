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
 *
 * Known, accepted race: if the token file appears after a resolve records
 * its mtime but before the chain reads it, the token file watcher can start
 * a second resolve before the first one finishes. Both resolves succeed, so
 * the user stays signed in; the cost is one extra STS exchange and a
 * `changed` event carrying the second resolve's credentials. Waiting for the
 * pending resolve instead would stall sign-in when an earlier resolve has
 * already failed its token read but has not settled yet.
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
	// Incremented each time a resolve starts, so a failure can tell whether a
	// newer resolve has superseded it (mirrors AuthProvider's session state).
	let resolveSeq = 0;

	return {
		resolve: async () => {
			const seq = ++resolveSeq;
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
				// A stale failure landing after a newer resolve succeeded must
				// not re-enable token file refreshes for the held credentials.
				if (seq === resolveSeq) {
					credentialsHeld = false;
				}
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
 * Poll the web-identity token file and call `resolve` when `shouldRefresh`
 * says a retry is due. `shouldRefresh` alone only runs when a consumer calls
 * `getSessions`, and a consumer that waits for a session event would never
 * make that call (#15292); resolving here fires the `added` event instead.
 *
 * Polls `shouldRefresh` directly rather than watching for change events:
 * createFileSystemWatcher misses the file's creation when its folder does
 * not exist yet, and fs.watchFile takes its baseline stat asynchronously, so
 * a file written before that stat lands is never reported as a change.
 * `shouldRefresh` compares against the last resolve's mtime instead, and
 * skips the stat while credentials are held. Returns undefined when
 * web-identity auth is not in use.
 */
export function watchWebIdentityTokenFile(
	env: NodeJS.ProcessEnv,
	credentialChain: CredentialChainConfig,
	resolve: () => Promise<unknown>,
	intervalMs = 5000,
): { dispose(): void } | undefined {
	if (!env.AWS_WEB_IDENTITY_TOKEN_FILE) {
		return undefined;
	}
	// Skip ticks while a check is in flight, so a slow STS exchange does not
	// pile up overlapping resolves.
	let checking = false;
	const timer = setInterval(async () => {
		if (checking) {
			return;
		}
		checking = true;
		try {
			if (await credentialChain.shouldRefresh?.()) {
				await resolve();
			}
		} finally {
			checking = false;
		}
	}, intervalMs);
	timer.unref();
	return { dispose: () => clearInterval(timer) };
}

async function getMtime(file: string): Promise<number | undefined> {
	try {
		return (await fs.promises.stat(file)).mtime.getTime();
	} catch {
		return undefined;
	}
}
