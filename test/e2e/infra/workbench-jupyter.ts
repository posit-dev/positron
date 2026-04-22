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

	private jupyterLabUrl: string | undefined;
	private readonly code: Code;

	constructor(code: Code) {
		// Initialize the base workbench with all standard Positron pages
		super(code);

		// Store code reference
		this.code = code;

		// Add Jupyter specific pages
		this.auth = new JupyterAuthPage(code);
		this.lab = new JupyterLabPage(code, this);
	}

	/**
	 * Store the JupyterLab URL for later navigation back
	 */
	setJupyterLabUrl(url: string): void {
		this.jupyterLabUrl = url;
	}

	/**
	 * Navigate back to the JupyterLab URL
	 */
	async navigateToJupyterLab(): Promise<void> {
		if (!this.jupyterLabUrl) {
			throw new Error('JupyterLab URL not set');
		}
		await this.code.driver.page.goto(this.jupyterLabUrl);
		await this.code.driver.page.waitForLoadState('networkidle');
	}
}
