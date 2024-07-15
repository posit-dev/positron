/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { Code } from '../code';
import { getInterpreterType, InterpreterInfo, InterpreterType } from './utils/positronInterpreterInfo';

interface InterpreterGroupLocation {
	description: string;
	index: number;
	path?: string;
}


const INTERPRETER_SELECTOR = '.top-action-bar-interpreters-manager .left';
const POSITRON_MODAL_POPUP = '.positron-modal-popup';

const INTERPRETER_GROUPS = '.positron-modal-popup .interpreter-groups .interpreter-group';
const PRIMARY_INTERPRETER_GROUP_DESCRIPTIONS = `${INTERPRETER_GROUPS} .primary-interpreter .line`;
const SECONDARY_INTERPRETER_GROUP_NAMES = `${INTERPRETER_GROUPS} .secondary-interpreter .line:nth-of-type(1)`;
const SECONDARY_INTERPRETER = `${INTERPRETER_GROUPS} .secondary-interpreter`;
const INTERPRETER_ACTION_BUTTON = '.primary-interpreter .interpreter-actions .action-button span';

/*
 *  Reuseable Positron interpreter selection functionality for tests to leverage.
 */
export class StartInterpreter {

	constructor(private code: Code) { }

	async selectInterpreter(desiredInterpreterType: InterpreterType, desiredInterpreterString: string) {

		await this.code.waitAndClick(INTERPRETER_SELECTOR);
		await this.code.waitForElement(POSITRON_MODAL_POPUP);

		const primaryInterpreter = await this.awaitDesiredPrimaryInterpreterGroupLoaded(desiredInterpreterType);
		this.code.logger.log(`Found primary interpreter ${primaryInterpreter.description} at index ${primaryInterpreter.index}`);

		const primaryIsMatch = primaryInterpreter.description.includes(desiredInterpreterString);
		let chosenInterpreter;
		if (!primaryIsMatch) {

			const secondaryInterpreters = await this.getSecondaryInterpreters(primaryInterpreter.index);
			this.code.logger.log('Secondary Interpreters:');
			secondaryInterpreters.forEach(interpreter => this.code.logger.log(interpreter.description));

			for (const secondaryInterpreter of secondaryInterpreters) {
				if (secondaryInterpreter.description.includes(desiredInterpreterString)) {
					chosenInterpreter = this.code.driver.getLocator(`${SECONDARY_INTERPRETER}:nth-of-type(${secondaryInterpreter.index})`);

					await chosenInterpreter.scrollIntoViewIfNeeded();
					await chosenInterpreter.isVisible();

					await chosenInterpreter.click();
					break;
				}
			}

		} else {
			this.code.logger.log('Primary interpreter matched');
			chosenInterpreter = this.code.driver.getLocator(`${INTERPRETER_GROUPS}:nth-of-type(${primaryInterpreter.index})`);
			await chosenInterpreter.waitFor({ state: 'visible' });
			await chosenInterpreter.click();
		}

		// Extra retries to click the interpreter if previous attempts didn't properly click and dismiss the dialog
		for (let i = 0; i < 10; i++) {
			try {
				const dialog = this.code.driver.getLocator(POSITRON_MODAL_POPUP);
				await dialog.waitFor({ state: 'detached', timeout: 2000 });
				break;
			} catch (e) {
				this.code.logger.log(`Error: ${e}, Retrying row click`);
				try {
					await chosenInterpreter!.click({ timeout: 1000 });
				} catch (f) {
					this.code.logger.log(`Inner Error: ${f}}`);
				}
			}
		}
	}

	async getSelectedInterpreterInfo(): Promise<InterpreterInfo | undefined> {
		// Get the label for the selected interpreter, e.g. Python 3.10.4 (Pyenv)
		const selectedInterpreterElem = await this.code.driver
			.getLocator('.top-action-bar-interpreters-manager')
			.getAttribute('aria-label');
		if (!selectedInterpreterElem) {
			return Promise.reject('There is no selected interpreter');
		}

		// Open the interpreter manager
		await this.code.waitAndClick(INTERPRETER_SELECTOR);
		await this.code.waitForElement(POSITRON_MODAL_POPUP);

		// Wait for the desired primary interpreter group to load
		const selectedInterpreter = await this.awaitDesiredPrimaryInterpreterGroupLoaded(selectedInterpreterElem);
		if (!selectedInterpreter.path) {
			return Promise.reject(`Could not retrieve interpreter path for ${selectedInterpreterElem}`);
		}

		// Determine the interpreter type for the selected interpreter
		const interpreterType = getInterpreterType(selectedInterpreter.description);
		if (!interpreterType) {
			return Promise.reject(`Could not determine interpreter type for ${selectedInterpreterElem}`);
		}

		// Return the interpreter info
		return {
			type: interpreterType,
			version: selectedInterpreter.description,
			path: selectedInterpreter.path
		} satisfies InterpreterInfo;
	}

	private async awaitDesiredPrimaryInterpreterGroupLoaded(interpreterNamePrefix: string): Promise<InterpreterGroupLocation> {

		let iterations = 0;
		while (iterations < 30) {

			// This element array is roughly represented as follows:
			// [firstInterpreterDescription, firstInterpreterPath, secondInterpreterDescription, secondInterpreterPath, ...]
			// The even indices are the interpreter descriptions and the odd indices are the interpreter paths
			const interpreterElems = await this.code.getElements(PRIMARY_INTERPRETER_GROUP_DESCRIPTIONS, false);
			if (!interpreterElems) {
				continue;
			}

			// Iterate the element array by 2, so we can get the name and path of each interpreter
			for (let i = 0; i < interpreterElems.length; i + 2) {
				const interpreterDesc = interpreterElems[i].textContent;
				this.code.logger.log(`Found interpreter: ${interpreterDesc}`);
				if (interpreterDesc.startsWith(interpreterNamePrefix)) {
					// Return as soon as we find the desired interpreter
					return {
						description: interpreterDesc, // e.g. Python 3.10.4 (Pyenv)
						index: i,
						path: interpreterElems[i + 1].textContent // e.g. /usr/bin/python3
					};
				}
			}

			iterations++;
			this.code.logger.log(`Waiting for ${interpreterNamePrefix} to load, try ${iterations}`);
			await this.code.driver.wait(3000);
		}
		return { description: '', index: -1 };

	}

	private async getSecondaryInterpreters(primaryGroupIndex: number): Promise<InterpreterGroupLocation[]> {

		const subSelector = `${INTERPRETER_GROUPS}:nth-of-type(${primaryGroupIndex}) ${INTERPRETER_ACTION_BUTTON}`;
		await this.code.waitAndClick(subSelector);

		const secondaryInterpreters = await this.code.getElements(SECONDARY_INTERPRETER_GROUP_NAMES, false);

		const loadedInterpreters: string[] = [];
		secondaryInterpreters?.forEach((interpreter) => { loadedInterpreters.push(interpreter.textContent); });

		const groups: InterpreterGroupLocation[] = [];
		let secondaryGroupIndex = 0;
		for (const interpreter of loadedInterpreters) {
			secondaryGroupIndex++;
			groups.push({ description: interpreter, index: secondaryGroupIndex });
		}
		return groups;

	}
}
