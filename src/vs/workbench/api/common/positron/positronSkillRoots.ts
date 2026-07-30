/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { joinPath } from '../../../../base/common/resources.js';

/** Directory name, relative to the application root, holding Positron's agent skills. */
const SKILLS_DIRECTORY = 'skills';

/**
 * Filesystem roots holding the agent skills that ship with Positron.
 *
 * Resolved from the extension host's `appRoot`, which is the application root on
 * whichever machine the extension host runs on -- the server in remote and
 * Workbench setups, where the skills actually live. The workbench's own
 * `appRoot` would be browser-side there and is not a filesystem path.
 *
 * Returns an empty array when there is nothing to offer: `appRoot` is optional,
 * and a non-`file` scheme has no meaningful `fsPath`. Callers treat "no roots"
 * as "this build ships no agent skills".
 */
export function getAgentSkillRoots(appRoot: URI | undefined): string[] {
	if (!appRoot || appRoot.scheme !== 'file') {
		return [];
	}
	return [joinPath(appRoot, SKILLS_DIRECTORY).fsPath];
}
