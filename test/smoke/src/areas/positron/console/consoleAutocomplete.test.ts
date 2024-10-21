/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { Application, PositronPythonFixtures } from '../../../../../automation';
import { setupAndStartApp } from '../../../test-runner/test-hooks';


describe('Console Autocomplete #web #win', () => {
	setupAndStartApp();

	describe('Console Autocomplete - Python', () => {
		before(async function () {
			await PositronPythonFixtures.SetupFixtures(this.app as Application);
		});

		it('Python - Verify Console Autocomplete [C...]', async function () {
			const app = this.app as Application;

			await app.workbench.positronConsole.pasteCodeToConsole('import pandas as pd');
			await app.workbench.positronConsole.sendEnterKey();
			await app.workbench.positronConsole.typeToConsole('df = pd.');

			await app.code.wait(60000);

		});
	});

});
