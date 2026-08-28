/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test } from '../_test.setup';
import { defineMemoryScenario } from './memory-scenario';

test.use({
	suiteId: __filename
});

const FILE = join('workspaces', 'quarto_inline_output', 'r_data_frame.qmd');

// Separate from quarto-render rather than one scenario doing both: that one's
// Rscript subprocess is expected to have exited by settle, so it never
// measures a live kernel. Inline execution keeps ark and its supervisor
// running through settle instead, which is a different cost to watch and a
// different thing to have regressed if this number moves.
//
// r_data_frame.qmd chosen over the fuller quarto_basic.qmd: a three-cell
// data.frame needs no ggplot2/dplyr, so there is nothing here for a missing
// dependency to break.
defineMemoryScenario({
	scenario: 'quarto-inline',
	prepare: async ({ app, sessions, openFile }) => {
		const { editors, inlineQuarto } = app.workbench;

		await sessions.startAndSkipMetadata({ language: 'R', waitForReady: true });

		await openFile(FILE);
		await editors.waitForActiveTab('r_data_frame.qmd');
		await inlineQuarto.expectKernelStatusVisible();

		await editors.clickTab('r_data_frame.qmd');
		await inlineQuarto.runCellAndWaitForOutput({ cellLine: 7, outputLine: 12 });
		await inlineQuarto.expectOutputVisible();
	},
	// Same gate as session-r: kernel only exists once a session really started,
	// so it is what stops a failed run from publishing an idle-shaped number.
	expectRoles: ['kernel', 'kernel_supervisor']
});
