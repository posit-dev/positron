/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { Code } from '../infra/code';
import { QuickAccess } from './quickaccess';
import { QuickInput } from './quickInput';

const OUTPUT_LINE = '.view-line';

/*
 *  Reuseable Positron output functionality for tests to leverage.
 */
export class Output {

	constructor(private code: Code, private quickaccess: QuickAccess, private quickinput: QuickInput) { }

	async openOutputPane(outputPaneNameContains: string) {
		await this.quickaccess.runCommand('workbench.action.showOutputChannels', { keepOpen: true });

		await this.quickinput.waitForQuickInputOpened();
		await this.quickinput.type(outputPaneNameContains);

		await this.quickinput.selectQuickInputElementContaining(outputPaneNameContains);
		await this.quickinput.waitForQuickInputClosed();
	}

	async clickOutputTab() {
		await this.code.driver.page.getByRole('tab', { name: 'Output' }).locator('a').click();
	}

	async waitForOutContaining(fragment: string) {
		const outputLine = this.code.driver.page.locator(OUTPUT_LINE);
		await outputLine.getByText(fragment).first().isVisible();
	}
}
