/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { Application, Logger } from '../../../../../automation';
import { installAllHandlers } from '../../../utils';

const INTERPRETER_SELECTOR = '.top-action-bar-interpreters-manager .left';
const POSITRON_MODAL_POPUP = '.positron-modal-popup';

const INTERPRETER_GROUPS = '.positron-modal-popup .interpreter-groups .interpreter-group';
const PRIMARY_INTERPRETER_GROUP_NAMES = `${INTERPRETER_GROUPS} .primary-interpreter .line:nth-of-type(1)`;
const SECONDARY_INTERPRETER_GROUP_NAMES = `${INTERPRETER_GROUPS} .secondary-interpreter .line:nth-of-type(1)`;
const SECONDARY_INTERPRETER = `${INTERPRETER_GROUPS} .secondary-interpreter`;
const INTERPRETER_ACTION_BUTTON = '.primary-interpreter .interpreter-actions .action-button span';

const POSITRON_MODAL_DIALOG_BOX = '.positron-modal-dialog-box';
const POSITRON_MODAL_DIALOG_BOX_OK = '.positron-modal-dialog-box .ok-cancel-action-bar .positron-button.action-bar-button.default';

export function setup(logger: Logger) {
	describe('Variables Pane', () => {

		// Shared before/after handling
		installAllHandlers(logger);

		it('Verifies Variables pane basic function with python interpreter', async function () {
			const app = this.app as Application;

			const desiredInterpreterType = 'Python';
			const desiredPython = process.env.POSITRON_PY_VER_SEL || '3.10.12 (PyEnv)';

			await app.code.waitAndClick(INTERPRETER_SELECTOR);
			await app.code.waitForElement(POSITRON_MODAL_POPUP);

			const primaryPython = await awaitDesiredPrimaryInterpreterGroupLoaded(app, desiredInterpreterType);
			logger.log(`Found primary python ${primaryPython.description} at index ${primaryPython.index}`, {});

			const primaryIsMatch = primaryPython.description.includes(desiredPython);
			if (!primaryIsMatch) {

				const secondaryInterpreters = await getSecondaryInterpreters(app, primaryPython.index);
				console.log(secondaryInterpreters.toString());

				for (const secondaryInterpreter of secondaryInterpreters) {
					if (secondaryInterpreter.description.includes(desiredPython)) {
						await app.code.waitAndClick(`${SECONDARY_INTERPRETER}:nth-of-type(${secondaryInterpreter.index})`);
						break;
					}
				}

			} else {
				await app.code.waitAndClick(INTERPRETER_GROUPS, primaryPython.index);
			}

			await app.code.wait(1000);

			// best way to handle something that might not be present?
			try {
				await app.code.waitForElement(POSITRON_MODAL_DIALOG_BOX, undefined, 50);
				await app.code.waitAndClick(POSITRON_MODAL_DIALOG_BOX_OK);
				console.log('Installed ipykernel');
				await app.code.wait(10000); // need to look for cursor instead
			} catch { }

			await app.code.driver.typeKeys('.lines-content .view-lines div', 'x=1\n');
			await app.code.driver.typeKeys('.lines-content .view-lines div', 'y=10\n');
			await app.code.driver.typeKeys('.lines-content .view-lines div', 'z=100\n');

			console.log('Entered lines in console defining variables');

			await app.code.wait(5000);

			const consoleTextContainer = await app.code.getElements('.console-instance .runtime-items div', false);
			consoleTextContainer?.forEach(item => console.log(item.textContent));

			const variablesLocator = app.code.driver.getLocator('.variables-instance .list .variable-item');
			const nameLocators = variablesLocator.locator('.name-column');
			const detailLocators = variablesLocator.locator('.details-column');

			const names = await Promise.all(Array.from({ length: await nameLocators.count() }, async (_, i) => {
				return await nameLocators.nth(i).innerText();
			}));

			console.log(names);

			const details = await Promise.all(Array.from({ length: await detailLocators.count() }, async (_, i) => {
				return await detailLocators.nth(i).innerText();
			}));

			console.log(details);

			const variablesMap = new Map<string, FlatVariables>();
			for (let i = 0; i < names.length; i++) {
				const detailsParts: string[] = details[i].split('\n');
				variablesMap.set(names[i], { value: detailsParts[0], type: detailsParts[1] });
			}

			expect(variablesMap.get('x')).toStrictEqual({ value: '1', type: 'int' });
			expect(variablesMap.get('y')).toStrictEqual({ value: '10', type: 'int' });
			expect(variablesMap.get('z')).toStrictEqual({ value: '100', type: 'int' });

		});
	});
}

interface FlatVariables {
	value: string;
	type: string;
}

interface InterpreterGroupLocation {
	description: string;
	index: number;
}

const awaitDesiredPrimaryInterpreterGroupLoaded = async (app: Application, interpreterNamePrefix: string): Promise<InterpreterGroupLocation> => {

	let iterations = 0;
	while (iterations < 10) {

		const interpreters = await app.code.getElements(PRIMARY_INTERPRETER_GROUP_NAMES, false);

		const loadedInterpreters: string[] = [];
		interpreters?.forEach((interpreter) => { loadedInterpreters.push(interpreter.textContent); });

		let found: string = '';
		let groupIndex = 0;
		for (const loadedInterpreter of loadedInterpreters) {
			groupIndex++;
			if (loadedInterpreter.startsWith(interpreterNamePrefix)) {
				found = loadedInterpreter;
				break;
			}
		}

		if (found) {
			return { description: found, index: groupIndex };
		} else {
			iterations++;
			console.log(`Waiting for ${interpreterNamePrefix} to load, try ${iterations}`);
			await app.code.driver.wait(3000);
		}
	}
	return { description: '', index: -1 };

};

const getSecondaryInterpreters = async (app: Application, primaryGroupIndex: number): Promise<InterpreterGroupLocation[]> => {

	const subSelector = `${INTERPRETER_GROUPS}:nth-of-type(${primaryGroupIndex}) ${INTERPRETER_ACTION_BUTTON}`;
	await app.code.waitAndClick(subSelector);

	const secondaryInterpreters = await app.code.getElements(SECONDARY_INTERPRETER_GROUP_NAMES, false);

	const loadedInterpreters: string[] = [];
	secondaryInterpreters?.forEach((interpreter) => { loadedInterpreters.push(interpreter.textContent); });

	const groups: InterpreterGroupLocation[] = [];
	let secondaryGroupIndex = 0;
	for (const interpreter of loadedInterpreters) {
		secondaryGroupIndex++;
		groups.push({ description: interpreter, index: secondaryGroupIndex });
	}
	return groups;

};
