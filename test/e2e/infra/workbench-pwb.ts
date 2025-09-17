/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Code } from './code';
import { Workbench } from './workbench';
import { DashboardPage } from '../pages/workbench/dashboard.page.js';

// Referred to as "Posit Workbench" (pwb) in the e2e tests
export class PositWorkbench extends Workbench {

	readonly dashboard: DashboardPage;

	constructor(code: Code) {
		// Initialize the base workbench with all standard Positron pages
		super(code);

		// Add external workbench specific pages
		this.dashboard = new DashboardPage(code);
	}
}
