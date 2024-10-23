/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { Application, PositronPythonFixtures, PositronRFixtures } from '../../../../../automation';
import { setupAndStartApp } from '../../../test-runner/test-hooks';
import { fail } from 'assert';


describe('Console Autocomplete #web #win', () => {
	setupAndStartApp();

	describe('Console Autocomplete - Python', () => {
		before(async function () {
			await PositronPythonFixtures.SetupFixtures(this.app as Application);
		});

		it('Python - Verify Console Autocomplete [C947968]', async function () {
			const app = this.app as Application;

			await app.workbench.positronConsole.pasteCodeToConsole('import pandas as pd');
			await app.workbench.positronConsole.sendEnterKey();
			await app.workbench.positronConsole.typeToConsole('df = pd.Dat');

			const suggestionList = await app.workbench.positronConsole.getSuggestions();

			if (suggestionList.length < 3) {
				fail('Less than 3 suggestions found');
			}
		});
	});


	describe('Console Autocomplete - R', () => {
		before(async function () {
			await PositronRFixtures.SetupFixtures(this.app as Application);
		});

		it('R - Verify Console Autocomplete [C947969]', async function () {
			const app = this.app as Application;

			await app.workbench.positronConsole.pasteCodeToConsole('library(arrow)');
			await app.workbench.positronConsole.sendEnterKey();
			await app.workbench.positronConsole.typeToConsole('df2 <- read_p');

			const suggestionList = await app.workbench.positronConsole.getSuggestions();

			if (suggestionList.length < 3) {
				fail('Less than 3 suggestions found');
			}
		});
	});

});
