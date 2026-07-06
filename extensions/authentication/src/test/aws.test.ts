/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { resolveAwsChainInit } from '../credentials/aws';

// clientConfig is only set for web-identity auth, so tests that assert it
// pass this env; SSO/other paths pass {} and must not get a clientConfig.
const WEB_IDENTITY_ENV = { AWS_WEB_IDENTITY_TOKEN_FILE: '/var/run/token' };

suite('resolveAwsChainInit', () => {
	test('passes the configured region to the STS client config', () => {
		const result = resolveAwsChainInit(
			{ AWS_REGION: 'eu-west-1' }, WEB_IDENTITY_ENV
		);

		assert.deepStrictEqual(result, {
			region: 'eu-west-1',
			profile: undefined,
			chainInit: { clientConfig: { region: 'eu-west-1' } },
		});
	});

	test('prefers the setting region over the AWS_REGION env var', () => {
		const result = resolveAwsChainInit(
			{ AWS_REGION: 'eu-west-1' }, { ...WEB_IDENTITY_ENV, AWS_REGION: 'us-west-2' }
		);

		assert.strictEqual(result.region, 'eu-west-1');
		assert.deepStrictEqual(result.chainInit, {
			clientConfig: { region: 'eu-west-1' },
		});
	});

	test('falls back to the AWS_REGION env var, then us-east-1', () => {
		const fromEnv = resolveAwsChainInit({}, { AWS_REGION: 'us-west-2' });
		assert.strictEqual(fromEnv.region, 'us-west-2');

		const fallback = resolveAwsChainInit(undefined, {});
		assert.strictEqual(fallback.region, 'us-east-1');
	});

	test('includes the profile when set, still passing the region', () => {
		const result = resolveAwsChainInit(
			{ AWS_PROFILE: 'dev', AWS_REGION: 'ap-southeast-2' }, WEB_IDENTITY_ENV
		);

		assert.deepStrictEqual(result, {
			region: 'ap-southeast-2',
			profile: 'dev',
			chainInit: { profile: 'dev', clientConfig: { region: 'ap-southeast-2' } },
		});
	});

	test('omits clientConfig without web-identity so SSO keeps sso_region', () => {
		const result = resolveAwsChainInit(
			{ AWS_PROFILE: 'sso-dev', AWS_REGION: 'eu-west-1' }, {}
		);

		assert.deepStrictEqual(result, {
			region: 'eu-west-1',
			profile: 'sso-dev',
			chainInit: { profile: 'sso-dev' },
		});
	});
});
