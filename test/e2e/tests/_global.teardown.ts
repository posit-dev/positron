/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import * as fs from 'fs';
// Imported from the modules directly, not the infra barrel: global teardown has no
// need to load the Electron/Playwright graph the barrel pulls in.
import { defaultWorkspacePath } from '../infra/test-runner/utils';
import { TestTeardown } from '../infra/test-teardown';

/**
 * Fails the run when the shared workspace was left dirty.
 *
 * Every worker has finished by now, so unlike the per-spec warning this cannot be
 * another spec's in-flight file: a spec's teardown does not cover everything it
 * writes. Gitignored artifacts are not reported.
 */
async function globalTeardown() {
	const workspacePath = defaultWorkspacePath();

	// Absent for the container-based projects, and when SKIP_CLONE skipped provisioning.
	if (!fs.existsSync(join(workspacePath, '.git'))) {
		return;
	}

	const leftover = [...new TestTeardown(workspacePath).dirtyFiles()].sort();
	if (leftover.length === 0) {
		return;
	}

	throw new Error(
		`The e2e workspace was left dirty by this run:\n  ${leftover.join('\n  ')}\n\n` +
		'Cover them in the owning spec\'s teardown: cleanup.restoreFiles for tracked files ' +
		'it edits, cleanup.removeTestFiles for files it creates. Note that files.autoSave is ' +
		'on by default in the web lanes, so an edit reaches disk there even without a save. ' +
		'A spec that failed before its teardown ran can also leave files here.'
	);
}

export default globalTeardown;
