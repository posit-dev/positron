/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { mapGitError } from './networkErrors';

/** An error shaped like the git extension's `GitError`. */
function gitError(fields: { message?: string; gitErrorCode?: string; stderr?: string }): Error {
	return Object.assign(new Error(fields.message ?? 'Failed to execute git'), fields);
}

describe('mapGitError', () => {
	test.each([
		['AuthenticationFailed', 'fatal: Authentication failed', 'sign-in-required'],
		['PushRejected', ' ! [rejected]        main -> main (fetch first)', 'shared-copy-moved'],
		['RemoteConnectionError', 'fatal: unable to access: Could not resolve host: github.com', 'offline'],
		['NoRemoteRepositorySpecified', 'fatal: No configured push destination.', 'unknown'],
	])('the code %s gives %s', (gitErrorCode, stderr, reason) => {
		expect(mapGitError(gitError({ gitErrorCode, stderr }))).toEqual({ ok: false, reason, detail: stderr.trim() });
	});

	test.each([
		'remote: error: GH006: Protected branch update failed for refs/heads/main.',
		' ! [remote rejected] main -> main (protected branch hook declined)',
	])('a push a protected branch refuses gives review-required, whatever the code: %s', stderr => {
		expect(mapGitError(gitError({ gitErrorCode: 'PushRejected', stderr }))).toEqual({ ok: false, reason: 'review-required', detail: stderr.trim() });
	});

	test('an error without stderr gives its message as the detail', () => {
		expect(mapGitError(gitError({ message: 'the remote hung up', gitErrorCode: 'RemoteConnectionError' }))).toEqual({ ok: false, reason: 'offline', detail: 'the remote hung up' });
	});

	test('a value that is not an error gives unknown with its text', () => {
		expect(mapGitError('something broke')).toEqual({ ok: false, reason: 'unknown', detail: 'something broke' });
		expect(mapGitError(undefined)).toEqual({ ok: false, reason: 'unknown', detail: 'undefined' });
	});
});
