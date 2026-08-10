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
 * Reports what the run left behind in the shared workspace, and fails on the half
 * of it that breaks other specs.
 *
 * Every worker has finished by now, so unlike the per-spec warning this cannot be
 * another spec's in-flight file. The two halves are not equally harmful:
 *
 * - A **modified tracked file** is a fixture the next spec will read, so a spec
 *   that leaves one has broken every spec that opens it. That fails the run.
 * - An **untracked byproduct** is noise, and its tail is endless: tool caches,
 *   bytecode, render intermediates, plot exports. Report it so it stays visible
 *   and can be gitignored or cleaned up, but don't fail a whole run over a .pyc.
 *
 * Gitignored artifacts are not reported at all.
 */
async function globalTeardown() {
	const workspacePath = defaultWorkspacePath();

	// Absent for the container-based projects, and when SKIP_CLONE skipped provisioning.
	if (!fs.existsSync(join(workspacePath, '.git'))) {
		return;
	}

	const dirty = [...new TestTeardown(workspacePath).dirtyFilesByStatus()].sort();
	const untracked = dirty.filter(([, status]) => status === '??').map(([file]) => file);
	const modified = dirty.filter(([, status]) => status !== '??').map(([file]) => file);

	if (untracked.length > 0) {
		console.warn(
			`The e2e workspace has untracked leftovers from this run:\n  ${untracked.join('\n  ')}\n\n` +
			'Remove them in the owning spec\'s teardown with cleanup.removeTestFiles, or add a ' +
			'.gitignore entry under test/e2e/test-files when no single spec owns them.'
		);
	}

	if (modified.length === 0) {
		return;
	}

	throw new Error(
		`The e2e workspace has tracked files this run modified and did not restore:\n  ${modified.join('\n  ')}\n\n` +
		'Every spec that opens one of these now reads the wrong content. Restore them in the ' +
		'owning spec\'s teardown with cleanup.restoreFiles. Note that files.autoSave is on by ' +
		'default in the web lanes, so an edit reaches disk there even without a save. A spec ' +
		'that failed before its teardown ran can also leave files here.'
	);
}

export default globalTeardown;
