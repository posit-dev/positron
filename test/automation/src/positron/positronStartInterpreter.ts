/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/


import { Code } from '../code';
import { PositronPopups } from './positronPopups';

interface InterpreterGroupLocation {
	description: string;
	index: number;
}


const INTERPRETER_SELECTOR = '.top-action-bar-interpreters-manager .left';
const POSITRON_MODAL_POPUP = '.positron-modal-popup';

const INTERPRETER_GROUPS = '.positron-modal-popup .interpreter-groups .interpreter-group';
const PRIMARY_INTERPRETER_GROUP_NAMES = `${INTERPRETER_GROUPS} .primary-interpreter .line:nth-of-type(1)`;
const SECONDARY_INTERPRETER_GROUP_NAMES = `${INTERPRETER_GROUPS} .secondary-interpreter .line:nth-of-type(1)`;
const SECONDARY_INTERPRETER = `${INTERPRETER_GROUPS} .secondary-interpreter`;
const INTERPRETER_ACTION_BUTTON = '.primary-interpreter .interpreter-actions .action-button span';
const DISCOVERY = '.discovery';

export class StartInterpreter {

	constructor(private code: Code, private positronPopups: PositronPopups) { }

	async selectInterpreter(desiredInterpreterType: string, desiredInterpreterString: string) {

		// discover might be present but might not
		// if it is present, wait for it to detach
		// if it is not present, take no action
		try {
			const discovery = this.code.driver.getLocator(DISCOVERY);
			await discovery.waitFor({ state: 'attached', timeout: 2000 });
			await discovery.waitFor({ state: 'detached', timeout: 120000 });
		} catch { }

		await this.code.waitAndClick(INTERPRETER_SELECTOR);
		await this.code.waitForElement(POSITRON_MODAL_POPUP);

		const primaryInterpreter = await this.awaitDesiredPrimaryInterpreterGroupLoaded(desiredInterpreterType);
		console.log(`Found primary interpreter ${primaryInterpreter.description} at index ${primaryInterpreter.index}`);

		const primaryIsMatch = primaryInterpreter.description.includes(desiredInterpreterString);
		let chosenInterpreter;
		if (!primaryIsMatch) {

			const secondaryInterpreters = await this.getSecondaryInterpreters(primaryInterpreter.index);
			console.log('Secondary Interpreters:');
			secondaryInterpreters.forEach(interpreter => console.log(interpreter.description));

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
			console.log('Primary interpreter matched');
			await this.code.waitAndClick(`${INTERPRETER_GROUPS}:nth-of-type(${primaryInterpreter.index})`);
		}

		// noop if dialog does not appear
		await this.positronPopups.installIPyKernel();

		for (let i = 0; i < 10; i++) {
			try {
				const dialog = this.code.driver.getLocator(POSITRON_MODAL_POPUP);
				await dialog.waitFor({ state: 'detached', timeout: 2000 });
				break;
			} catch {
				console.log('Retrying row click');
				try {
					await chosenInterpreter!.click({ timeout: 1000 });
					await this.positronPopups.installIPyKernel();
				} catch { }
			}
		}
	}

	private async awaitDesiredPrimaryInterpreterGroupLoaded(interpreterNamePrefix: string): Promise<InterpreterGroupLocation> {

		let iterations = 0;
		while (iterations < 30) {

			const interpreters = await this.code.getElements(PRIMARY_INTERPRETER_GROUP_NAMES, false);

			const loadedInterpreters: string[] = [];
			interpreters?.forEach((interpreter) => {
				loadedInterpreters.push(interpreter.textContent);
			});

			let found: string = '';
			let groupIndex = 0;
			for (const loadedInterpreter of loadedInterpreters) {
				groupIndex++;
				console.log(`Found interpreter: ${loadedInterpreter}`);
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
				await this.code.driver.wait(3000);
			}
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
