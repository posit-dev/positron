/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Application, PositronRFixtures, PositronUserSettingsFixtures, UserSetting } from '../../../../../automation';
import { setupAndStartApp } from '../../../test-runner/test-hooks';

describe('Reticulate', () => {
	setupAndStartApp();
	let app: Application;
	let userSettings: PositronUserSettingsFixtures;

	describe('Reticulate', () => {
		before(async function () {
			app = this.app as Application;

			try {

				await PositronRFixtures.SetupFixtures(this.app as Application);

				userSettings = new PositronUserSettingsFixtures(app);

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

			// unset the use of the VSCode file picker
			await userSettings.unsetUserSettings();

		});

		it('R - Verify Basic Reticulate Functionality [C...]', async function () {

			await app.workbench.positronConsole.pasteCodeToConsole('reticulate::repl_python()');
			await app.workbench.positronConsole.sendEnterKey();

			await app.workbench.positronConsole.waitForReady('>>>');

			console.log('test');
		});
	});
});
