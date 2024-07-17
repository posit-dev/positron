/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { Code } from '../code';
import { QuickAccess } from '../quickaccess';
import { QuickInput } from '../quickinput';

const OUTPUT_LINE = '.view-line';

/*
 *  Reuseable Positron output functionality for tests to leverage.
 */
export class PositronOutput {

	constructor(private code: Code, private quickaccess: QuickAccess, private quickinput: QuickInput) { }

	async openOutputPane(outputPaneNameContains: string) {
		await this.quickaccess.runCommand('workbench.action.showOutputChannels', { keepOpen: true });

		await this.quickinput.waitForQuickInputOpened();
		await this.quickinput.type(outputPaneNameContains);

		await this.quickinput.selectQuickInputElementContaining(outputPaneNameContains);
		await this.quickinput.waitForQuickInputClosed();
	}

	async waitForOutContaining(fragment: string) {
		const outputLine = this.code.driver.getLocator(OUTPUT_LINE);
		await outputLine.getByText(fragment).first().isVisible();
	}
}
