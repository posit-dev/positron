/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { expect, test } from '../_test.setup';
import { defineMemoryScenario } from './memory-scenario';

test.use({
	suiteId: __filename
});

// Reproduces a customer report of Quarto's LSP plus renderer sitting at roughly
// 358 MB, which idle never measured. No expectRoles/expectProcesses: the LSP is
// already `language_server` at idle in this workspace, and quarto_basic.qmd
// renders via knitr's R engine (Rscript, not ark), which is expected to have
// exited by settle time -- nothing distinguishes this state by role or name.
defineMemoryScenario({
	scenario: 'quarto-render',
	prepare: async ({ app, openFile }) => {
		const outputPath = join(app.workspacePathOrFolder, 'workspaces', 'quarto_basic', 'quarto_basic.html');

		// A stale output from a prior local run would let the poll below pass
		// before this run's render even starts.
		if (existsSync(outputPath)) {
			unlinkSync(outputPath);
		}

		await openFile(join('workspaces', 'quarto_basic', 'quarto_basic.qmd'));
		await app.workbench.quickaccess.runCommand('quarto.render.document', { keepOpen: true });
		await app.workbench.quickInput.selectQuickInputElementContaining('html');

		await expect(async () => {
			expect(existsSync(outputPath)).toBe(true);
		}).toPass({ timeout: 20_000 });
	}
});
