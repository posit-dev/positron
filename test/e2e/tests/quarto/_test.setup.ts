/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test as base, TestFixtures, WorkerFixtures } from '../_test.setup';

interface QuartoTestFixtures extends TestFixtures { }

interface QuartoWorkerFixtures extends WorkerFixtures {
	enableQuartoInlineOutput: boolean;
}

export const test = base.extend<QuartoTestFixtures, QuartoWorkerFixtures>({
	enableQuartoInlineOutput: [true, { scope: 'worker', option: true }],

	beforeApp: [
		async ({ useLegacyNotebookEditor, enableDataConnections, enableQuartoInlineOutput, settingsFile }, use) => {
			if (useLegacyNotebookEditor) {
				await settingsFile.append({ 'positron.notebook.enabled': false });
			}
			if (enableDataConnections) {
				await settingsFile.append({ 'dataConnections.enabled': true });
			}
			if (enableQuartoInlineOutput) {
				await settingsFile.append({ 'positron.quarto.inlineOutput.enabled': true });
			}
			await use();
		},
		{ scope: 'worker' }
	],
});

export { tags, expect } from '../_test.setup';
