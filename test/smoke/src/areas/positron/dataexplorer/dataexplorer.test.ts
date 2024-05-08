/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/


import { Application, Logger, PositronPythonFixtures } from '../../../../../automation';
import { installAllHandlers } from '../../../utils';

export function setup(logger: Logger) {
	describe('Data Explorer', () => {

		// Shared before/after handling
		installAllHandlers(logger);

		describe('Python Data Explorer', () => {

			before(async function () {

				const pythonFixtures = new PositronPythonFixtures(this.app);
				await pythonFixtures.startPythonInterpreter();

			});

			after(async function () {
				console.log('running after');
				const app = this.app as Application;
				await app.code.driver.takeScreenshot('debug');

			});

			it('Verifies basic data explorer functionality', async function () {
				const app = this.app as Application;

				// console.log('Installing pandas');
				// await app.workbench.positronConsole.sendCodeToConsole('pip install pandas\n');
				// await app.workbench.positronConsole.sendEnterKey();

				// const restartMessage = 'Note: you may need to restart the kernel to use updated packages.';
				// await app.workbench.positronConsole.waitForEndingConsoleText(restartMessage);
				// console.log('pandas installed');

				// await app.code.driver.takeScreenshot('debug2');
				// await app.workbench.positronConsole.waitForReady('>>>');
				// await app.code.driver.takeScreenshot('debug3');

				const script = `import pandas as pd
data = {'Name':['Jai', 'Princi', 'Gaurav', 'Anuj'],
		'Age':[27, 24, 22, 32],
		'Address':['Delhi', 'Kanpur', 'Allahabad', 'Kannauj'],
		'Qualification':['Msc', 'MA', 'MCA', 'Phd']}
df = pd.DataFrame(data)
print(df[['Name', 'Qualification']])\n`;

				console.log('Sending code to console');
				await app.workbench.positronConsole.sendCodeToConsole(script);
				console.log('Sending enter key');
				await app.workbench.positronConsole.sendEnterKey();
				await app.workbench.positronConsole.waitForReady('>>>');

				console.log('Opening data grid');
				await app.workbench.positronVariables.doubleClickVariableRow('df');

				console.log('Hiding secondary side bar');
				const hideSecondarySideBar = app.code.driver.getLocator('[aria-label="Hide Secondary Side Bar"]');
				await hideSecondarySideBar.click();

				const columnHeaders = app.code.driver.getLocator('.data-explorer-panel .column-2 .data-grid-column-headers');
				await columnHeaders.waitFor({ state: 'attached' });

				const headers = columnHeaders.locator('.data-grid-column-header .title-description .title');
				const headerContents = await headers.all();
				const headerNames: string[] = [];

				for (const headerContent of headerContents) {
					const header = await headerContent.innerText();
					headerNames.push(header);
				}

				const dataGridRows = app.code.driver.getLocator('.data-explorer-panel .column-2 .data-grid-rows');
				await dataGridRows.waitFor({ state: 'attached' });

				const rows = dataGridRows.locator('.data-grid-row');
				const rowContents = await rows.all();

				const tableData: any[] = [];

				for (const rowContent of rowContents) {
					const cells = rowContent.locator('.data-grid-row-cell .content .text');
					const cellContents = await cells.all();
					const rowData: any = {};
					let columnIndex = 0;

					for (const cellContent of cellContents) {
						const innerText = await cellContent.innerText();
						rowData[headerNames[columnIndex]] = innerText;
						columnIndex++;
					}

					tableData.push(rowData);
				}

				console.log(tableData);

			});

		});

	});
}
