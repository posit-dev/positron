/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/


import { Application, Logger } from '../../../../../automation';
import { installAllHandlers } from '../../../utils';
import { fail } from 'assert';

export function setup(logger: Logger) {
	describe('Data Explorer', () => {

		// Shared before/after handling
		installAllHandlers(logger);

		it.only('Verifies basic data explorer functionality', async function () {
			const app = this.app as Application;

			const desiredPython = process.env.POSITRON_PY_VER_SEL;
			if (desiredPython === undefined) {
				fail('Please be sure to set env var POSITRON_PY_VER_SEL to the UI text corresponding to the Python version for the test');
			}
			await app.workbench.startInterpreter.selectInterpreter('Python', desiredPython);

			// noop if dialog does not appear
			await app.workbench.positronPopups.installIPyKernel();

			await app.workbench.positronConsole.waitForStarted('>>>');

			await app.workbench.positronConsole.logConsoleContents();



			await app.workbench.positronConsole.typeToConsole('pip install pandas');
			await app.workbench.positronConsole.sendEnterKey();

			const restartMessage = 'Note: you may need to restart the kernel to use updated packages.';
			await app.workbench.positronConsole.waitForEndingConsoleText(restartMessage);

			await app.workbench.positronConsole.waitForStarted('>>>');

			//await app.workbench.positronConsole.typeToConsole('pip install matplotlib');
			//await app.workbench.positronConsole.sendEnterKey();
			//await app.workbench.positronConsole.waitForEndingConsoleText(restartMessage);

			await app.workbench.positronConsole.waitForStarted('>>>');

			const script = `import pandas as pd
data = {'Name':['Jai', 'Princi', 'Gaurav', 'Anuj'],
		'Age':[27, 24, 22, 32],
		'Address':['Delhi', 'Kanpur', 'Allahabad', 'Kannauj'],
		'Qualification':['Msc', 'MA', 'MCA', 'Phd']}
df = pd.DataFrame(data)
print(df[['Name', 'Qualification']])
`;

			await app.workbench.positronConsole.sendCodeToConsole(script);
			await app.workbench.positronConsole.sendEnterKey();
			await app.workbench.positronConsole.sendEnterKey();


			await app.code.wait(20000);

			console.log('junk');


		});

	});
}
