/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags, expect } from '../../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Environment Modules', { tag: [tags.WORKBENCH, tags.ENVIRONMENT_MODULES] }, () => {

	test('Python - Create module environment', async function ({ app }) {
		await app.workbench.quickaccess.createModuleEnvironment(
			'Python 3.10.12 Module',
			['python'],
			['python/3.10.12']
		);

		// Verify the module environment was created with the correct category
		const runtimes = await app.workbench.sessions.getAllAvailableRuntimes();
		const pythonModule = runtimes.find(r => r.name.includes('Python 3.10.12') && r.name.includes('Module'));
		expect(pythonModule).toBeDefined();
		expect(pythonModule?.category).toBe('Module');
	});

	test('R - Create module environment', async function ({ app }) {
		await app.workbench.quickaccess.createModuleEnvironment(
			'R 4.4.1 Module',
			['r'],
			['R/4.4.1']
		);

		// Verify the module environment was created with the correct category
		const runtimes = await app.workbench.sessions.getAllAvailableRuntimes();
		const rModule = runtimes.find(r => r.name.includes('R 4.4.1') && r.name.includes('Module'));
		expect(rModule).toBeDefined();
		expect(rModule?.category).toBe('Module');
	});

});
