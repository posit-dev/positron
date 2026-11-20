/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { NetworkResult } from './ports';

/**
 * The failed `NetworkResult` for an error the git extension threw while fetching or pushing.
 * The extension's `GitError` has a `gitErrorCode` and git's `stderr`. A push that a protected
 * branch or a repository rule refuses (`GH006`, `protected branch`, or `must be made through a
 * pull request` in stderr, in any case) gives `review-required`; that test comes before the
 * code, because git reports such a push as `PushRejected` too. Then
 * `AuthenticationFailed` gives `sign-in-required`, `PushRejected` gives `shared-copy-moved`,
 * `RemoteConnectionError` gives `offline`, and anything else `unknown`. The detail is the
 * stderr, or the error's message when there is none.
 */
export function mapGitError(error: unknown): Extract<NetworkResult, { ok: false }> {
	if (!(error instanceof Error)) {
		return { ok: false, reason: 'unknown', detail: String(error) };
	}
	const { gitErrorCode, stderr } = error as Error & { gitErrorCode?: unknown; stderr?: unknown };
	const output = typeof stderr === 'string' ? stderr.trim() : '';
	const detail = output === '' ? error.message : output;
	if (/GH006|protected branch|must be made through a pull request/i.test(output)) {
		return { ok: false, reason: 'review-required', detail };
	}
	switch (gitErrorCode) {
		case 'AuthenticationFailed':
			return { ok: false, reason: 'sign-in-required', detail };
		case 'PushRejected':
			return { ok: false, reason: 'shared-copy-moved', detail };
		case 'RemoteConnectionError':
			return { ok: false, reason: 'offline', detail };
		default:
			return { ok: false, reason: 'unknown', detail };
	}
}
