/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { Code } from '../code';
import { getInterpreterType, InterpreterInfo, InterpreterType } from './utils/positronInterpreterInfo';

interface InterpreterGroupInfo {
	interpreterDescription: string;
	groupIndex: number;
	interpreterPath?: string;
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
		this.code.logger.log(`Found primary interpreter ${primaryInterpreter.interpreterDescription} at index ${primaryInterpreter.groupIndex}`);

		const primaryIsMatch = primaryInterpreter.interpreterDescription.includes(desiredInterpreterString);
		let chosenInterpreter;
		if (!primaryIsMatch) {

			const secondaryInterpreters = await this.getSecondaryInterpreters(primaryInterpreter.groupIndex);
			this.code.logger.log('Secondary Interpreters:');
			secondaryInterpreters.forEach(interpreter => this.code.logger.log(interpreter.interpreterDescription));

			for (const secondaryInterpreter of secondaryInterpreters) {
				if (secondaryInterpreter.interpreterDescription.includes(desiredInterpreterString)) {
					chosenInterpreter = this.code.driver.getLocator(`${SECONDARY_INTERPRETER}:nth-of-type(${secondaryInterpreter.groupIndex})`);

					await chosenInterpreter.scrollIntoViewIfNeeded();
					await chosenInterpreter.isVisible();

					await chosenInterpreter.click();
					break;
				}
			}

		} else {
			this.code.logger.log('Primary interpreter matched');
			chosenInterpreter = this.code.driver.getLocator(`${INTERPRETER_GROUPS}:nth-of-type(${primaryInterpreter.groupIndex})`);
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
		const selectedInterpreterLabel = await this.code.driver
			.getLocator('.top-action-bar-interpreters-manager')
			.getAttribute('aria-label');
		if (!selectedInterpreterLabel) {
			return Promise.reject('There is no selected interpreter');
		}

		// Open the interpreter manager
		await this.code.waitAndClick(INTERPRETER_SELECTOR);
		await this.code.waitForElement(POSITRON_MODAL_POPUP);

		// Wait for the desired primary interpreter group to load
		const selectedInterpreter = await this.awaitDesiredPrimaryInterpreterGroupLoaded(selectedInterpreterLabel);
		if (!selectedInterpreter.interpreterDescription || selectedInterpreter.groupIndex < 0) {
			return Promise.reject(`Something went wrong while trying to load the info for ${selectedInterpreterLabel}`);
		}
		if (!selectedInterpreter.interpreterPath) {
			return Promise.reject(`Could not retrieve interpreter path for ${selectedInterpreterLabel}`);
		}

		// Determine the interpreter type for the selected interpreter
		const interpreterType = getInterpreterType(selectedInterpreter.interpreterDescription);
		if (!interpreterType) {
			return Promise.reject(`Could not determine interpreter type for ${selectedInterpreterLabel}`);
		}

		// Return the interpreter info
		return {
			type: interpreterType,
			version: selectedInterpreter.interpreterDescription,
			path: selectedInterpreter.interpreterPath
		} satisfies InterpreterInfo;
	}

	private async awaitDesiredPrimaryInterpreterGroupLoaded(
		interpreterNamePrefix: string
	): Promise<InterpreterGroupInfo> {
		// Retry up to 30 times for the primary interpreter group info to load
		for (let i = 0; i < 30; i++) {
			// This element array is roughly represented as follows:
			// [firstInterpreterDescription, firstInterpreterPath, secondInterpreterDescription, secondInterpreterPath]
			// e.g. ['Python 3.10.4 (Pyenv)', '/usr/bin/python3', 'R 4.4.0', '/Library/Frameworks/R.framework/Versions/4.4-arm64/Resources/bin/R']
			// The even indices are the interpreter descriptions and the odd indices are the interpreter paths
			const interpreterElems = await this.code.getElements(
				PRIMARY_INTERPRETER_GROUP_DESCRIPTIONS,
				false
			);
			if (interpreterElems && interpreterElems.length) {
				// Iterate the element array by 2, so we can get the name and path of each interpreter
				for (let j = 0; j < interpreterElems.length; j + 2) {
					const interpreterDesc = interpreterElems[j].textContent;
					this.code.logger.log(
						`Found interpreter: ${interpreterDesc}`
					);
					if (interpreterDesc.startsWith(interpreterNamePrefix)) {
						const interpreterPath = interpreterElems[j + 1].textContent;
						// Return as soon as we find the desired interpreter
						return {
							interpreterDescription: interpreterDesc, // e.g. Python 3.10.4 (Pyenv)
							groupIndex: j,
							interpreterPath: interpreterPath, // e.g. /usr/bin/python3
						};
					}
				}
			}

			this.code.logger.log(
				`Waiting for ${interpreterNamePrefix} to load, try ${i}`
			);
			await this.code.driver.wait(3000);
		}

		return { interpreterDescription: '', groupIndex: -1 };
	}

	private async getSecondaryInterpreters(primaryGroupIndex: number): Promise<InterpreterGroupInfo[]> {

		const subSelector = `${INTERPRETER_GROUPS}:nth-of-type(${primaryGroupIndex}) ${INTERPRETER_ACTION_BUTTON}`;
		await this.code.waitAndClick(subSelector);

		const secondaryInterpreters = await this.code.getElements(SECONDARY_INTERPRETER_GROUP_NAMES, false);

		const loadedInterpreters: string[] = [];
		secondaryInterpreters?.forEach((interpreter) => { loadedInterpreters.push(interpreter.textContent); });

		const groups: InterpreterGroupInfo[] = [];
		let secondaryGroupIndex = 0;
		for (const interpreter of loadedInterpreters) {
			secondaryGroupIndex++;
			groups.push({ interpreterDescription: interpreter, groupIndex: secondaryGroupIndex });
		}
		return groups;

	}
}
