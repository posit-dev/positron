/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { classifyAwsChainError } from '../credentials/awsSso';

// The sentence the AWS SDK appends to every token error an `aws sso login`
// would fix. Copied verbatim from @aws-sdk/token-providers.
const REFRESH = `To refresh this SSO session run 'aws sso login' with the corresponding profile.`;

/** An error wrapping another as its `cause`, the way the chain wraps ours. */
function wrapped(message: string, cause: Error): Error {
	const err = new Error(message);
	(err as { cause?: unknown }).cause = cause;
	return err;
}

suite('classifyAwsChainError', () => {
	test('recognizes the recoverable SSO errors and rejects the rest', () => {
		const results = [
			// Expired cached token, no profile named.
			classifyAwsChainError(new Error(`Token is expired. ${REFRESH}`)),
			// Missing or invalid token, profile named.
			classifyAwsChainError(new Error(
				`The SSO session token associated with profile=default was not found or is invalid. ${REFRESH}`
			)),
			// Non-default profile name.
			classifyAwsChainError(new Error(
				`The SSO session token associated with profile=sso-dev was not found or is invalid. ${REFRESH}`
			)),
			// Wrapped in the generic error the credential chain throws.
			// `new Error(msg, { cause })` is ES2022 and this extension compiles
			// against lib es2020, so attach the cause by assignment.
			classifyAwsChainError(wrapped('No credentials found for AWS.', new Error(`Token is expired. ${REFRESH}`))),
			// Not recoverable by a login: nothing configured at all.
			classifyAwsChainError(new Error('Could not load credentials from any providers')),
			// Not recoverable by a login: the profile does not exist.
			classifyAwsChainError(new Error(`Profile 'dev' could not be found in shared credentials file.`)),
			// Not an error object at all.
			classifyAwsChainError(undefined),
		];

		assert.deepStrictEqual(results, [
			{ kind: 'expired-sso' },
			{ kind: 'expired-sso', profile: 'default' },
			{ kind: 'expired-sso', profile: 'sso-dev' },
			{ kind: 'expired-sso' },
			undefined,
			undefined,
			undefined,
		]);
	});
});
