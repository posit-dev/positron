/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test as base, TestFixtures, WorkerFixtures } from '../_test.setup';

interface ReticulateTestFixtures extends TestFixtures { }

interface ReticulateWorkerFixtures extends WorkerFixtures {
	enableReticulate: boolean;
}

export const test = base.extend<ReticulateTestFixtures, ReticulateWorkerFixtures>({
	enableReticulate: [true, { scope: 'worker', option: true }],

	beforeApp: [
		async ({ enableReticulate, settingsFile }, use) => {
			if (enableReticulate) {
				settingsFile.append({
					'positron.reticulate.enabled': true,
					'kernelSupervisor.transport': 'tcp'
				});
			}
			await use();
		},
		{ scope: 'worker' }
	],
});

export { tags, expect } from '../_test.setup';
