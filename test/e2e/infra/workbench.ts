/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Code } from './code';
import { Positron } from './positron';
import { DashboardPage } from '../pages/workbench/dashboard.page.js';
import { AuthPage } from '../pages/workbench/auth.page.js';

export class Workbench extends Positron {

	readonly auth: AuthPage
	readonly dashboard: DashboardPage;


	constructor(code: Code) {
		// Initialize the base workbench with all standard Positron pages
		super(code);

		// Add workbench specific pages
		this.auth = new AuthPage(code);
		this.dashboard = new DashboardPage(code, this.quickInput);
	}
}
