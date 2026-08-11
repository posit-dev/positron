/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import { normalizeWindowsArch } from './kernel';

/** Architecture vocabulary used by the ark binary sniffers. */
export type ArkArch = 'arm64' | 'x64';

/**
 * Resolves the libR path exactly as ark does, so this check agrees with the
 * process that actually loads the library. See
 * `harp::find_r_shared_library_folder`.
 *
 * Platform and architecture are parameters rather than reads of `os.platform()`
 * so every row is testable on any machine.
 */
export function resolveLibRPath(
	rHome: string,
	platform: NodeJS.Platform,
	arkArch: ArkArch | undefined
): string {
	if (platform === 'win32') {
		// arm64 ark uses a flatter layout; everything else lives under bin/x64.
		const folder = arkArch === 'arm64'
			? path.join(rHome, 'bin')
			: path.join(rHome, 'bin', 'x64');
		return path.join(folder, 'R.dll');
	}
	const name = platform === 'darwin' ? 'libR.dylib' : 'libR.so';
	return path.join(rHome, 'lib', name);
}

/**
 * True when R and ark are built for different architectures. An unknown value
 * on either side yields false: missing information is not evidence of trouble.
 */
export function archesMismatch(rArch: string | undefined, arkArch: ArkArch | undefined): boolean {
	if (!rArch || !arkArch) {
		return false;
	}
	const normalizedR = normalizeWindowsArch(rArch);
	if (!normalizedR) {
		return false;
	}
	return normalizedR !== arkArch;
}
