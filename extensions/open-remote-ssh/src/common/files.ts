/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// The code in extensions/open-remote-ssh has been adapted from https://github.com/jeanp413/open-remote-ssh,
// which is licensed under the MIT license.

import * as fs from 'fs';
import * as os from 'os';

const homeDir = os.homedir();

export async function exists(path: string) {
	try {
		await fs.promises.access(path);
		return true;
	} catch {
		return false;
	}
}

export function untildify(path: string) {
	return path.replace(/^~(?=$|\/|\\)/, homeDir);
}

export function normalizeToSlash(path: string) {
	return path.replace(/\\/g, '/');
}
