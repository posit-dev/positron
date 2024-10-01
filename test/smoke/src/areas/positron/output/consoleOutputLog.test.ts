/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { expect } from '@playwright/test';
import { Application, PositronPythonFixtures, PositronRFixtures } from '../../../../../automation';
import { setupAndStartApp } from '../../../positronUtils';


describe('Console Output #web', () => {
	setupAndStartApp();

	describe('Console Output Log - Python', () => {
		before(async function () {
			await PositronPythonFixtures.SetupFixtures(this.app as Application);
		});

		after(async function () {
			const app = this.app as Application;
			await app.workbench.positronLayouts.enterLayout('stacked');
		});

		it('Python - Verify Console Output Log Contents [C667518]', async function () {
			const app = this.app as Application;

			const activeConsole = app.workbench.positronConsole.activeConsole;
			await activeConsole.click();

			await app.workbench.positronConsole.typeToConsole('a = b');
			await app.workbench.positronConsole.sendEnterKey();

			// retry in case the console output log is slow to appear
			await expect(async () => {
				await app.workbench.positronOutput.openOutputPane(process.env.POSITRON_PY_VER_SEL!);

				await app.workbench.positronLayouts.enterLayout('fullSizedPanel');

				await app.workbench.positronOutput.waitForOutContaining("name 'b' is not defined");
			}).toPass({ timeout: 60000 });
		});
	});

	describe('Console Output Log - R', () => {
		before(async function () {
			await PositronRFixtures.SetupFixtures(this.app as Application);
		});

		after(async function () {
			const app = this.app as Application;
			await app.workbench.positronLayouts.enterLayout('stacked');
		});

		it('R - Verify Console Output Log Contents [C667519]', async function () {
			const app = this.app as Application;

			const activeConsole = app.workbench.positronConsole.activeConsole;
			await activeConsole.click();

			await app.workbench.positronConsole.typeToConsole('a = b');
			await app.workbench.positronConsole.sendEnterKey();

			// retry in case the console output log is slow to appear
			await expect(async () => {
				await app.workbench.positronOutput.openOutputPane(process.env.POSITRON_R_VER_SEL!);

				await app.workbench.positronLayouts.enterLayout('fullSizedPanel');

				await app.workbench.positronOutput.waitForOutContaining("object 'b' not found");
			}).toPass({ timeout: 60000 });

		});
	});
});

