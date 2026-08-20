/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { AuthProviderLogger } from '../authProviderLogger';

type ChainInit = Parameters<typeof fromNodeProviderChain>[0];

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
