/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../../_test.setup';

test.use({
	suiteId: __filename
});

const SCRIPT = 'sleep-job.R';
// The marker sleep-job.R prints once its sleep is over.
const FINISHED_MARKER = 'Workbench job finished after 20 seconds';

test.describe('Workbench Jobs', {
	tag: [tags.WORKBENCH],
}, () => {

	// The R session is what makes the job runnable: the launcher defaults its R Version to the
	// foreground session's interpreter, and with no session it falls back to "(System Default)",
	// which is the bare command `R` -- unresolvable in the job's environment (exit code 127).
	test('Run an R script as a Workbench job', async function ({ app, openFile, r }) {
		// The launcher's Script field is read-only and seeded from the active editor, so open the
		// script first.
		await openFile(`workspaces/workbench-job/${SCRIPT}`);

		await app.positWorkbench.jobs.openView();
		await app.positWorkbench.jobs.openLauncher();
		await app.positWorkbench.jobs.expectLauncherToBeSeededWith(SCRIPT);
		await app.positWorkbench.jobs.startJob();

		// The script sleeps for 20s, so the job is observable in the Running state before it
		// reaches Succeeded.
		await app.positWorkbench.jobs.expectJobStatus(SCRIPT, 'Running', 30000);
		await app.positWorkbench.jobs.expectJobStatus(SCRIPT, 'Succeeded', 60000);

		// A zero exit code alone would not prove the script body ran, so check the job's streamed
		// output for the marker it prints on the way out.
		await app.positWorkbench.jobs.openJobOutput();
		await app.workbench.output.expectOutputToContain(FINISHED_MARKER);
	});
});
