/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Application, Logger } from '../../../../../automation';
import { installAllHandlers } from '../../../utils';

export function setup(logger: Logger) {
	describe('A new Test Area', () => {

		// Shared before/after handling
		installAllHandlers(logger);

		describe('New Feature Test', () => {
			// All tests under this run in same Positron instance
			before(async function () {

			});

			it.only('New Test Case', async function () {
				// TestRail #
				const app = this.app as Application;
				await app.workbench.positronNewProjectWizard.startNewProject();
				await app.workbench.positronNewProjectWizard.projectWizardCancelButton.click();
				// await app.workbench.positronNewProjectWizard.newPythonProjectButton.click();
			});


		});

	});
}

