/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Derives the folder name a Git repository URL would be cloned into, e.g.
 * 'https://github.com/posit-dev/positron.git' becomes 'positron'.
 *
 * This mirrors `Git.clone()` in extensions/git/src/git.ts, which derives the same name whenever no
 * `targetName` is passed. The dialog pre-fills its folder name field with this, so keeping the two
 * derivations identical is what makes the pre-filled value a no-op: a user who leaves it alone
 * lands in the folder they would have landed in before the field existed.
 *
 * @param url The Git repository URL, as typed into the dialog.
 * @returns The derived folder name, or an empty string if no URL has been entered yet.
 */
export function folderNameFromGitRepoUrl(url: string): string {
	// The Git extension strips a pasted 'git clone ' prefix before deriving a name, so a command
	// copied out of a README derives the same name here as it would there.
	const trimmedUrl = url.trim().replace(/^git\s+clone\s+/, '');
	if (!trimmedUrl) {
		return '';
	}

	// decodeURI throws on a malformed escape such as '%zz'. Such a URL is used as typed rather than
	// failing, since its last segment still names a folder, and the clone itself is what reports a
	// URL that turns out to be unusable.
	let decodedUrl: string;
	try {
		decodedUrl = decodeURI(trimmedUrl);
	} catch {
		decodedUrl = trimmedUrl;
	}

	const derivedName = decodedUrl
		.replace(/[\/]+$/, '')		// Trailing slashes.
		.replace(/^.*[\/\\]/, '')	// Everything through the last separator.
		.replace(/\.git$/, '');		// The .git suffix.

	// A URL whose last segment is nothing but '.git' leaves no name behind. Git.clone() falls back
	// to 'repository' there, and so does this, or the field would sit empty for a URL that used to
	// clone fine. An empty URL is the one case that stays empty, since there is nothing yet to
	// derive a name from.
	return derivedName || 'repository';
}
