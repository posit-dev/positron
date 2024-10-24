/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { Application, PositronPythonFixtures } from '../../../../../automation';
import { setupAndStartApp } from '../../../test-runner/test-hooks';


describe('Outline #web', () => {
	setupAndStartApp();

	describe('Outline Test - Python', () => {
		before(async function () {
			await PositronPythonFixtures.SetupFixtures(this.app as Application);
		});

		it('Python - Verify Outline Contents [C...]', async function () {
			const app = this.app as Application;


		});
	});
});


