/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import * as resources from '../../../../base/common/resources.js';
import { IPathService } from './pathService.js';

/**
 * Expands a path of `~`, or `~` and a separator, to the user home. A path such as `~name` does not
 * expand, because it names another user's home on POSIX or a file in the current folder.
 * @param path The path.
 * @param pathService The path service.
 * @param options Whether to use the local user home instead of the remote one.
 * @returns The user home, or a path in it. Undefined when the path does not start with `~`.
 */
export async function expandHomePath(path: string, pathService: IPathService, options?: { preferLocal: boolean }): Promise<URI | undefined> {
	// The separators of the OS where the files are. On POSIX, a backslash is a valid name
	// character, so only a slash separates.
	const separator = (await pathService.path).sep === '\\' ? /[\\/]/ : /\//;
	if (path !== '~' && !(path.startsWith('~') && separator.test(path.charAt(1)))) {
		return undefined;
	}

	// Join the segments one at a time, because joinPath does not split on backslashes.
	const segments = path.slice(1).split(separator).filter(segment => segment.length > 0);
	const userHome = await pathService.userHome(options);
	return segments.length > 0 ? resources.joinPath(userHome, ...segments) : userHome;
}
