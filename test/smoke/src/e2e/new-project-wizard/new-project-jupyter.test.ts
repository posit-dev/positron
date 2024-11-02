/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { ProjectType, ProjectWizardNavigateAction } from '../../../../automation';
import { test } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('New Project Wizard - Jupyter', () => {
	test('Jupyter Project Defaults [C629352]', { tag: ['@pr'] }, async function ({ app }) {
		const pw = app.workbench.positronNewProjectWizard;
		await pw.startNewProject(ProjectType.JUPYTER_NOTEBOOK);
		await pw.navigate(ProjectWizardNavigateAction.NEXT);
		await pw.navigate(ProjectWizardNavigateAction.NEXT);
		await pw.navigate(ProjectWizardNavigateAction.CREATE);
		await pw.currentOrNewWindowSelectionModal.currentWindowButton.click();
		await app.workbench.positronExplorer.explorerProjectTitle.waitForText('myJupyterNotebook');
		// NOTE: For completeness, we probably want to await app.workbench.positronConsole.waitForReady('>>>', 10000);
		// here, but it's timing out in CI, so it is not included for now.
	});
});


