/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { Application, PositronRFixtures, PositronUserSettingsFixtures, UserSetting } from '../../../../../automation';
import { setupAndStartApp } from '../../../test-runner/test-hooks';

describe('Reticulate #win #web', () => {
	setupAndStartApp();
	let app: Application;
	let userSettings: PositronUserSettingsFixtures;

	describe('Reticulate', () => {
		before(async function () {
			app = this.app as Application;

			try {

				await PositronRFixtures.SetupFixtures(this.app as Application);

				userSettings = new PositronUserSettingsFixtures(app);

				// remove this once https://github.com/posit-dev/positron/issues/5226
				// is resolved
				const kernelSupervisorSetting: UserSetting = ['positronKernelSupervisor.enable', 'false'];
				const reticulateSetting: UserSetting = ['positron.reticulate.enabled', 'true'];

				await userSettings.setUserSettings([
					kernelSupervisorSetting,
					reticulateSetting
				]
				);

			} catch (e) {
				this.app.code.driver.takeScreenshot('reticulateSetup');
				throw e;
			}
		});

		after(async function () {
			await userSettings.unsetUserSettings();

		});

		it('R - Verify Basic Reticulate Functionality [C...]', async function () {

			await app.workbench.positronConsole.pasteCodeToConsole('reticulate::repl_python()');
			await app.workbench.positronConsole.sendEnterKey();

			await app.workbench.positronConsole.waitForReady('>>>');

			await app.workbench.positronConsole.pasteCodeToConsole('x=100');
			await app.workbench.positronConsole.sendEnterKey();

			await PositronRFixtures.SetupFixtures(this.app as Application);

			await app.workbench.positronConsole.pasteCodeToConsole('y<-reticulate::py$x');
			await app.workbench.positronConsole.sendEnterKey();

			await app.workbench.positronLayouts.enterLayout('fullSizedAuxBar');

			await expect(async () => {
				const variablesMap = await app.workbench.positronVariables.getFlatVariables();
				expect(variablesMap.get('y')).toStrictEqual({ value: '100', type: 'int' });
			}).toPass({ timeout: 60000 });

		});
	});
});
