/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Application, Logger, PositronRFixtures } from '../../../../../automation';
import { installAllHandlers } from '../../../utils';

/*
 * R console tests
 */
export function setup(logger: Logger) {
	describe('Editor Pane: R', () => {

		// Shared before/after handling
		installAllHandlers(logger);

		describe('R Fast Execution', () => {

			beforeEach(async function () {

				await PositronRFixtures.SetupFixtures(this.app as Application);

			});

			it('Verify fast execution is not out of order [C...]', async function () {
				const app = this.app as Application;

			});

		});

	});
}
