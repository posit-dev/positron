/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { basename } from 'path';
import { expect, test } from '../_test.setup';
import { defineMemoryScenario } from './memory-scenario';

test.use({
	suiteId: __filename
});

/**
 * A plausible working set rather than a stress test: ten files a real project
 * would have open at once.
 *
 * Mixed types on purpose, though it matters less than it looks. The fixture
 * workspace's `workspaceContains` events already start ruff, air, and Quarto at
 * idle, so this measures Monaco models plus per-file language-server document
 * state, not language-server startup.
 *
 * Basenames must stay unique across this list: the tab assertion below matches a
 * tab by accessible name, and two files called README.md would fail Playwright's
 * strict mode rather than fail informatively.
 */
const FILES = [
	'workspaces/generate-data-frames-py/simple-data-frames.py',
	'workspaces/python-plots/altair-plots.py',
	'workspaces/polars-dataframe-py/polars_basic.py',
	'workspaces/sparklines/sparklines.r',
	'workspaces/nyc-flights-data-r/flights-data-frame.r',
	'workspaces/shiny-r-example/gen_table.R',
	'workspaces/quarto_python/report.qmd',
	'workspaces/visual-mode/visual-mode.qmd',
	'workspaces/visual-mode/visual-mode.md',
	'workspaces/assistant/positron.md'
];

// No session, so this is measured against idle. Ten open editors is a state idle
// cannot see at all -- it opens none -- and open editors are a classic place for
// memory to creep, since each one is a Monaco model that lives until it is closed.
defineMemoryScenario({
	scenario: 'editors',
	prepare: async ({ app, openFile }) => {
		const { editors } = app.workbench;

		for (const file of FILES) {
			await openFile(file);
		}

		// Every tab asserted individually, not just a count: if one file failed to
		// open, the failure should name it. This is also the scenario's ONLY state
		// gate -- unlike data-explorer, opening editors starts no new process, so
		// neither expectRoles nor expectProcesses can prove the state was reached.
		// The gap that leaves is narrow: a tab closing between here and sampling
		// would go unnoticed.
		for (const file of FILES) {
			await expect(editors.editorTab(basename(file)),
				`${file} did not open; the scenario is measuring fewer editors than it claims`).toBeVisible();
		}
	}
});
