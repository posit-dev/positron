/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Code } from './code';
import { Workbench } from './workbench';
import { JupyterAuthPage } from '../pages/jupyter/jupyter-auth.page';
import { JupyterLabPage } from '../pages/jupyter/jupyter-lab.page';

export class PositJupyter extends Workbench {

	readonly auth: JupyterAuthPage;
	readonly lab: JupyterLabPage;

	constructor(code: Code) {
		// Initialize the base workbench with all standard Positron pages
		super(code);

		// Add Jupyter specific pages
		this.auth = new JupyterAuthPage(code);
		this.lab = new JupyterLabPage(code);
	}
}
