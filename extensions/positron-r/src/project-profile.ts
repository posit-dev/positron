/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * R only reads the `.Rprofile` of its working directory (or of the home
 * directory). Notebook sessions start in the notebook's folder, so they miss
 * the profile of a project above it, such as the one that renv or rv.
 */
export function findProjectRProfile(workingDirectory: string, rootDirectory: string): string | undefined {
	const relative = path.relative(rootDirectory, workingDirectory);
	if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
		return undefined;
	}
	if (fs.existsSync(path.join(workingDirectory, '.Rprofile'))) {
		return undefined;
	}

	// Walk up from the parent of `workingDirectory` to `rootDirectory`
	const segments = relative.split(path.sep);
	for (let depth = segments.length - 1; depth >= 0; depth--) {
		const dir = path.join(rootDirectory, ...segments.slice(0, depth));
		const profile = path.join(dir, '.Rprofile');
		const homeDirectory = os.homedir()

		if (fs.existsSync(profile)) {
			return path.relative(homeDirectory, dir) === '' ? undefined : profile;
		}
	}
	return undefined;
}
