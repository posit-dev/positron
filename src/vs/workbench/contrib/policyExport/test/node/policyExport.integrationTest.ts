/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { dirname, join } from '../../../../../base/common/path.js';
import { FileAccess } from '../../../../../base/common/network.js';
import * as util from 'util';

const execFile = util.promisify(cp.execFile);

suite('PolicyExport Integration Tests', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('exported policy data matches checked-in file', async function () {
		// --- Start Positron ---
		// This test launches Electron twice to export policy data. Upstream skips
		// it in CI via TF_BUILD (set by Azure DevOps); it is meant to run locally.
		// Positron's CI is GitHub Actions, which doesn't set TF_BUILD, so skip there
		// too - the headless export can't complete in the CI container.
		if (process.env['TF_BUILD'] || process.env['GITHUB_ACTIONS']) {
			this.skip();
		}
		// --- End Positron ---

		// The canonical export launches both product entrypoints.
		this.timeout(120000);

		// FileAccess.asFileUri('') points to the 'out' directory.
		const rootPath = dirname(FileAccess.asFileUri('').fsPath);
		const exportScript = join(rootPath, 'build/lib/policies/exportPolicyData.ts');
		const fixturePath = join(rootPath, 'src/vs/workbench/contrib/policyExport/test/node/extensionPolicyFixture.json');
		await execFile('node', [exportScript, '--check', '--skip-transpile'], {
			cwd: rootPath,
			env: { ...process.env, DISTRO_PRODUCT_JSON: fixturePath, VSCODE_SKIP_PRELAUNCH: '1' },
			maxBuffer: 10 * 1024 * 1024,
		});
	});
});
