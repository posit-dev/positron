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
	test('passes the catalog region to the STS client config', () => {
		const result = resolveAwsChainInit(
			{ region: 'eu-west-1' }, WEB_IDENTITY_ENV
		);

		assert.deepStrictEqual(result, { clientConfig: { region: 'eu-west-1' } });
	});

	test('ignores the AWS_REGION env var; the catalog region wins', () => {
		const result = resolveAwsChainInit(
			{ region: 'eu-west-1' }, { ...WEB_IDENTITY_ENV, AWS_REGION: 'us-west-2' }
		);

		assert.deepStrictEqual(result, { clientConfig: { region: 'eu-west-1' } });
	});

	test('ignores AWS_REGION/AWS_PROFILE env vars when the catalog is empty', () => {
		// The env fallbacks were removed: env vars reach this function only
		// through the catalog now, so an env-only region/profile is dropped.
		const empty = resolveAwsChainInit(
			{}, { ...WEB_IDENTITY_ENV, AWS_REGION: 'us-west-2', AWS_PROFILE: 'dev' }
		);
		assert.deepStrictEqual(empty, { clientConfig: { region: 'us-east-1' } });

		const undefinedConfig = resolveAwsChainInit(
			undefined, { ...WEB_IDENTITY_ENV, AWS_REGION: 'us-west-2', AWS_PROFILE: 'dev' }
		);
		assert.deepStrictEqual(undefinedConfig, { clientConfig: { region: 'us-east-1' } });
	});

	test('defaults the web-identity region to us-east-1 when the catalog is undefined', () => {
		const result = resolveAwsChainInit(undefined, WEB_IDENTITY_ENV);

		assert.deepStrictEqual(result, { clientConfig: { region: 'us-east-1' } });
	});

	test('includes the profile when set, still passing the region', () => {
		const result = resolveAwsChainInit(
			{ profile: 'work', region: 'ap-southeast-2' }, WEB_IDENTITY_ENV
		);

		assert.deepStrictEqual(result, {
			profile: 'work',
			clientConfig: { region: 'ap-southeast-2' },
		});
	});

	test('omits clientConfig without web-identity so SSO keeps sso_region', () => {
		const result = resolveAwsChainInit(
			{ profile: 'sso-dev', region: 'eu-west-1' }, {}
		);

		assert.deepStrictEqual(result, { profile: 'sso-dev' });
	});
});
