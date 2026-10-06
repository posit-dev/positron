/* eslint-disable header/header */
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Returns a test that decides whether a file in the web server build gets a
 * build-time `.gz` copy. Only files that the browser can fetch get a copy:
 * the workbench (`out/`), the packages in `remote/web/package.json`, and
 * extension files outside `node_modules`. The server and the Node extension
 * host load every other file from disk, so a copy of it is never served and
 * only adds to the file count of the install.
 *
 * A file that the test rejects is still served, without compression:
 * `serveFile()` in `webClientServer.ts` falls back to the original file when
 * the `.gz` copy does not exist.
 *
 * @param webDependencies The package names in `remote/web/package.json`.
 * @returns A test that takes a path relative to the build root.
 */
export function createBrowserFetchableTest(webDependencies: readonly string[]): (relativePath: string) => boolean {
	const webPackagePrefixes = webDependencies.map(name => `node_modules/${name}/`);

	return relativePath => {
		const p = relativePath.replace(/\\/g, '/');
		if (p.startsWith('out/')) {
			return true;
		}
		if (p.startsWith('extensions/')) {
			return !p.includes('/node_modules/');
		}
		return webPackagePrefixes.some(prefix => p.startsWith(prefix));
	};
}
