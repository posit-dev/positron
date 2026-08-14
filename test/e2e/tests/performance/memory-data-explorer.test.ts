/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from '../_test.setup';
import { defineMemoryScenario } from './memory-scenario';

test.use({
	suiteId: __filename
});

// No session, so this is measured against idle rather than session-python. The
// duckdb worker backs CSVs opened straight from the explorer with no interpreter
// involved; opening a dataframe out of a Python session is a different path that
// never touches the worker, and its number would blend kernel memory, the
// dataframe, and the explorer UI. settingsMemory.json's manual startup behavior
// keeps every kernel out of the tree.
defineMemoryScenario({
	scenario: 'data-explorer',
	prepare: async ({ app, openDataFile }) => {
		const { dataExplorer } = app.workbench;

		// The worker spawns on the first query rather than on activation, so opening
		// the file is what brings it into existence.
		//
		// A deliberately tiny CSV, measured rather than guessed. Running this scenario
		// against flights.csv (36 MB, 336k rows) instead puts the worker at 279 MB,
		// but only 110 MB of that is the native binding and duckdb runtime; the other
		// 168 MB is buffer pool sized to the data. That cache is also all of the
		// noise: tree-total spread across three launches was 52 MB on flights.csv
		// against 15 MB here, and the worker's own spread 66 MB against 1.6 MB. A
		// regression in what the worker costs to *exist* -- the thing #13998 caused
		// and this scenario is here to catch -- would hide inside that. Buffer pool
		// also moves with duckdb upgrades and runner RAM rather than with Positron,
		// so trending it would mean alerting on nothing.
		await openDataFile('data-files/small_file.csv');
		await dataExplorer.waitForIdle();

		// Rows present, not merely an editor tab: the state assertion the scenario
		// selection design asks for. A grid that never loaded would otherwise
		// snapshot as a suspiciously cheap CSV instead of failing.
		await dataExplorer.expectStatusBarToHaveText(/10\s+rows\s+10\s+columns/);
	},
	// Deliberately not `expectRoles: ['extension_child']`: pet holds that role at
	// idle, so it would pass on a run where the CSV never opened. Loose on the
	// worker's filename because the build emits `duckdbWorker.js` while label.ts
	// renders it through deriveExtensionName, and neither spelling is this
	// scenario's business.
	//
	// The editor stays open for the whole snapshot on purpose. The worker
	// self-terminates 120s after the LAST data explorer closes (IDLE_SHUTDOWN_MS in
	// extensions/positron-duckdb/src/extension.ts) and settling plus sampling can
	// outlast that, so closing the tab to tidy up would delete the process being
	// measured and leave this gate as the only thing that noticed.
	expectProcesses: [/duckdb/i]
});
