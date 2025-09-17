/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Code } from './code';
import { Workbench } from './workbench';
import { DashboardPage } from '../pages/workbench/dashboard.page.js';
import { AuthPage } from '../pages/workbench/auth.page.js';

export class PositWorkbench extends Workbench {

	readonly auth: AuthPage
	readonly dashboard: DashboardPage;


	constructor(code: Code) {
		// Initialize the base workbench with all standard Positron pages
		super(code);

		// Add workbench specific pages
		this.auth = new AuthPage(code);
		this.dashboard = new DashboardPage(code);
	}
}
