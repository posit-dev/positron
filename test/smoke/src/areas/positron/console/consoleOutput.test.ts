/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { Application, PositronRFixtures } from '../../../../../automation';
import { setupAndStartApp } from '../../../positronUtils';

describe('Console Output', () => {
	setupAndStartApp();

	describe('Console Output - R', () => {
		before(async function () {
			await PositronRFixtures.SetupFixtures(this.app as Application);
			await this.app.workbench.positronLayouts.enterLayout('fullSizedPanel');
		});

		after(async function () {
			const app = this.app as Application;
			await app.workbench.positronLayouts.enterLayout('stacked');
		});

		it('R - Console output in a loop with short pauses [C885225]', async function () {
			const app = this.app as Application;

			const code = `tokens <- c(
"",
"Why",
" do",
" programmers",
" prefer",
" dark",
" mode",
"?\n\n",
"Because",
" light",
" attracts",
" bugs",
"!"
)

for(token in tokens) {
	cat(token)
	Sys.sleep(0.01)
}`;

			await app.workbench.positronConsole.pasteCodeToConsole(code);

			await app.workbench.positronConsole.sendEnterKey();

			await app.workbench.positronConsole.waitForConsoleContents((contents) => contents.some((line) => line.includes('Why do programmers prefer dark mode')));
			await app.workbench.positronConsole.waitForConsoleContents((contents) => contents.some((line) => line.includes('Because light attracts bugs!')));

		});
	});
});
