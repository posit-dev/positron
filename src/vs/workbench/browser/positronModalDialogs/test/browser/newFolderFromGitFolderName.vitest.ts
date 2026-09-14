/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { folderNameFromGitRepoUrl } from '../../newFolderFromGitFolderName.js';

describe('folderNameFromGitRepoUrl', () => {
	it('takes the last path segment, without the .git suffix', () => {
		expect(folderNameFromGitRepoUrl('https://github.com/posit-dev/positron.git')).toBe('positron');
		expect(folderNameFromGitRepoUrl('https://github.com/posit-dev/positron')).toBe('positron');
	});

	it('handles an SSH URL and an scp-style remote', () => {
		expect(folderNameFromGitRepoUrl('ssh://git@github.com/posit-dev/positron.git')).toBe('positron');
		expect(folderNameFromGitRepoUrl('git@github.com:posit-dev/positron.git')).toBe('positron');
	});

	it('ignores trailing slashes', () => {
		expect(folderNameFromGitRepoUrl('https://github.com/posit-dev/positron/')).toBe('positron');
		expect(folderNameFromGitRepoUrl('https://github.com/posit-dev/positron.git//')).toBe('positron');
	});

	it('strips a pasted git clone prefix, as the Git extension does', () => {
		expect(folderNameFromGitRepoUrl('git clone https://github.com/posit-dev/positron.git')).toBe('positron');
	});

	it('trims surrounding whitespace', () => {
		expect(folderNameFromGitRepoUrl('  https://github.com/posit-dev/positron.git  ')).toBe('positron');
	});

	it('decodes percent escapes, so the folder is named what the user reads', () => {
		expect(folderNameFromGitRepoUrl('https://example.com/team/my%20repo.git')).toBe('my repo');
	});

	it('uses a URL with a malformed escape as typed rather than failing', () => {
		expect(folderNameFromGitRepoUrl('https://example.com/team/repo%zz.git')).toBe('repo%zz');
	});

	it('splits on a backslash, for a Windows path to a local repository', () => {
		expect(folderNameFromGitRepoUrl('C:\\repos\\positron')).toBe('positron');
	});

	it('returns an empty name when there is nothing to derive one from', () => {
		expect(folderNameFromGitRepoUrl('')).toBe('');
		expect(folderNameFromGitRepoUrl('   ')).toBe('');
	});

	it('falls back to the host when a URL names no repository, as the Git extension does', () => {
		// Not a clonable URL, but the name shown has to be the name Git would have used, or the
		// pre-filled field would quietly change where a clone lands.
		expect(folderNameFromGitRepoUrl('https://github.com/')).toBe('github.com');
	});
});
