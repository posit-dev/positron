/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Application, Logger } from '../../../../../automation';
import { installAllHandlers } from '../../../utils';

export function setup(logger: Logger) {
	describe('Variables Pane', () => {

		// Shared before/after handling
		installAllHandlers(logger);

		it('verifies Variables pane exists', async function () {
			const app = this.app as Application;

			await app.code.waitForElement('.positron-variables-container');
		});
	});
}
