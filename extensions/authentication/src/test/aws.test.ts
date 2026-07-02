/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { resolveAwsChainInit } from '../credentials/aws';

suite('resolveAwsChainInit', () => {
	test('passes the configured region to the STS client config', () => {
		const result = resolveAwsChainInit(
			{ AWS_REGION: 'eu-west-1' }, {}
		);

		assert.deepStrictEqual(result, {
			region: 'eu-west-1',
			profile: undefined,
			chainInit: { clientConfig: { region: 'eu-west-1' } },
		});
	});

	test('prefers the setting region over the AWS_REGION env var', () => {
		const result = resolveAwsChainInit(
			{ AWS_REGION: 'eu-west-1' }, { AWS_REGION: 'us-west-2' }
		);

		assert.strictEqual(result.region, 'eu-west-1');
		assert.deepStrictEqual(result.chainInit, {
			clientConfig: { region: 'eu-west-1' },
		});
	});

	test('falls back to the AWS_REGION env var, then us-east-1', () => {
		const fromEnv = resolveAwsChainInit({}, { AWS_REGION: 'us-west-2' });
		assert.deepStrictEqual(fromEnv.chainInit, {
			clientConfig: { region: 'us-west-2' },
		});

		const fallback = resolveAwsChainInit(undefined, {});
		assert.deepStrictEqual(fallback.chainInit, {
			clientConfig: { region: 'us-east-1' },
		});
	});

	test('includes the profile when set, still passing the region', () => {
		const result = resolveAwsChainInit(
			{ AWS_PROFILE: 'dev', AWS_REGION: 'ap-southeast-2' }, {}
		);

		assert.deepStrictEqual(result, {
			region: 'ap-southeast-2',
			profile: 'dev',
			chainInit: { profile: 'dev', clientConfig: { region: 'ap-southeast-2' } },
		});
	});
});
