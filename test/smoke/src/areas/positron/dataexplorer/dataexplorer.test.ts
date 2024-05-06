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

			it('Verifies basic data explorer functionality', async function () {
				const app = this.app as Application;

				await app.workbench.positronConsole.typeToConsole('pip install pandas');
				await app.workbench.positronConsole.sendEnterKey();

				const restartMessage = 'Note: you may need to restart the kernel to use updated packages.';
				await app.workbench.positronConsole.waitForEndingConsoleText(restartMessage);

				await app.workbench.positronConsole.waitForReady('>>>');

				const script = `import pandas as pd
data = {'Name':['Jai', 'Princi', 'Gaurav', 'Anuj'],
		'Age':[27, 24, 22, 32],
		'Address':['Delhi', 'Kanpur', 'Allahabad', 'Kannauj'],
		'Qualification':['Msc', 'MA', 'MCA', 'Phd']}
df = pd.DataFrame(data)
print(df[['Name', 'Qualification']])`;

				await app.workbench.positronConsole.sendCodeToConsole(script);
				await app.workbench.positronConsole.sendEnterKey();
				await app.workbench.positronConsole.waitForReady('>>>');
				await app.workbench.positronVariables.doubleClickVariableRow('df');

				console.log('debug');
			});

		});

	});
}
