/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Editors } from '../editors';
import { Code } from '../code';
import { basename, isAbsolute } from 'path';
import { PositronQuickInput } from './positronQuickInput';
import { expect } from '@playwright/test';

enum QuickAccessKind {
	Files = 1,
	Commands,
	Symbols
}

export class PositronQuickAccess {

	constructor(private code: Code, private editors: Editors, private quickInput: PositronQuickInput) { }

	async openDataFile(path: string): Promise<void> {
		if (!isAbsolute(path)) {
			// we require absolute paths to get a single
			// result back that is unique and avoid hitting
			// the search process to reduce chances of
			// search needing longer.
			throw new Error('PositronQuickAccess.openFile requires an absolute path');
		}

		// quick access shows files with the basename of the path
		await this.openFileQuickAccessAndWait(path, basename(path));

		// open first element
		await this.quickInput.selectQuickInputElement(0);
	}



	async openFileQuickAccessAndWait(searchValue: string, expectedFirstElementNameOrExpectedResultCount: string | number): Promise<void> {

		// make sure the file quick access is not "polluted"
		// with entries from the editor history when opening
		await this.runCommand('workbench.action.clearEditorHistory');

		const PollingStrategy = {
			Stop: true,
			Continue: false
		};

		let retries = 0;
		let success = false;

		while (++retries < 10) {
			let retry = false;

			try {
				await this.openQuickAccessWithRetry(QuickAccessKind.Files, searchValue);
				await this.quickInput.waitForQuickInputElements(elementNames => {
					this.code.logger.log('QuickAccess: resulting elements: ', elementNames);

					// Quick access seems to be still running -> retry
					if (elementNames.length === 0) {
						this.code.logger.log('QuickAccess: file search returned 0 elements, will continue polling...');

						return PollingStrategy.Continue;
					}

					// Quick access does not seem healthy/ready -> retry
					const firstElementName = elementNames[0];
					if (firstElementName === 'No matching results') {
						this.code.logger.log(`QuickAccess: file search returned "No matching results", will retry...`);

						retry = true;

						return PollingStrategy.Stop;
					}

					// Expected: number of results
					if (typeof expectedFirstElementNameOrExpectedResultCount === 'number') {
						if (elementNames.length === expectedFirstElementNameOrExpectedResultCount) {
							success = true;

							return PollingStrategy.Stop;
						}

						this.code.logger.log(`QuickAccess: file search returned ${elementNames.length} results but was expecting ${expectedFirstElementNameOrExpectedResultCount}, will retry...`);

						retry = true;

						return PollingStrategy.Stop;
					}

					// Expected: string
					else {
						if (firstElementName === expectedFirstElementNameOrExpectedResultCount) {
							success = true;

							return PollingStrategy.Stop;
						}

						this.code.logger.log(`QuickAccess: file search returned ${firstElementName} as first result but was expecting ${expectedFirstElementNameOrExpectedResultCount}, will retry...`);

						retry = true;

						return PollingStrategy.Stop;
					}
				});
			} catch (error) {
				this.code.logger.log(`QuickAccess: file search waitForQuickInputElements threw an error ${error}, will retry...`);

				retry = true;
			}

			if (!retry) {
				break;
			}

			await this.quickInput.closeQuickInput();
		}

		if (!success) {
			if (typeof expectedFirstElementNameOrExpectedResultCount === 'string') {
				throw new Error(`Quick open file search was unable to find '${expectedFirstElementNameOrExpectedResultCount}' after 10 attempts, giving up.`);
			} else {
				throw new Error(`Quick open file search was unable to find ${expectedFirstElementNameOrExpectedResultCount} result items after 10 attempts, giving up.`);
			}
		}
	}

	async openFile(path: string): Promise<void> {
		if (!isAbsolute(path)) {
			// we require absolute paths to get a single
			// result back that is unique and avoid hitting
			// the search process to reduce chances of
			// search needing longer.
			throw new Error('QuickAccess.openFile requires an absolute path');
		}

		const fileName = basename(path);

		// quick access shows files with the basename of the path
		await this.openFileQuickAccessAndWait(path, basename(path));

		// open first element
		await this.quickInput.selectQuickInputElement(0);

		// wait for editor being focused
		await this.editors.waitForActiveTab(fileName);
		await this.editors.selectTab(fileName);
	}

	private async openQuickAccessWithRetry(kind: QuickAccessKind, value?: string): Promise<void> {
		// Other parts of code might steal focus away from quickinput :(
		await expect(async () => {
			// Open via keybinding
			switch (kind) {
				case QuickAccessKind.Files:
					await this.code.driver.page.keyboard.press(process.platform === 'darwin' ? 'Meta+P' : 'Control+P');
					break;
				case QuickAccessKind.Symbols:
					await this.code.driver.page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+O' : 'Control+Shift+O');
					break;
				case QuickAccessKind.Commands:
					await this.code.driver.page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+P' : 'Control+Shift+P');
					break;
				default:
					throw new Error(`Unsupported QuickAccessKind: ${kind}`);
			}

			// Await for quick input widget opened
			try {
				await this.quickInput.waitForQuickInputOpened();
			} catch (err) {
				await this.code.dispatchKeybinding('escape');
				throw err;
			}
		}).toPass({
			timeout: 15000,
			intervals: [1000]
		});

		// Type value if any
		if (value) {
			await this.quickInput.type(value);
		}
	}


	async runCommand(commandId: string, options?: { keepOpen?: boolean; exactLabelMatch?: boolean }): Promise<void> {
		const keepOpen = options?.keepOpen;
		const exactLabelMatch = options?.exactLabelMatch;

		const openCommandPalletteAndTypeCommand = async (): Promise<boolean> => {
			// open commands picker
			await this.openQuickAccessWithRetry(QuickAccessKind.Commands, `>${commandId}`);

			// wait for quick input element text
			const text = await this.quickInput.waitForQuickInputElementText();

			if (text === 'No matching commands' || (exactLabelMatch && text !== commandId)) {
				return false;
			}

			return true;
		};

		await expect(async () => {
			const hasCommandFound = await openCommandPalletteAndTypeCommand();
			if (!hasCommandFound) {
				this.code.logger.log(`QuickAccess: No matching commands, retrying...`);
				await this.quickInput.closeQuickInput();
				throw new Error('Command not found'); // Signal to retry
			}
		}).toPass({
			timeout: 15000,
			intervals: [1000],
		});

		this.code.logger.log('QuickAccess: Command found and successfully executed.');

		// wait and click on best choice
		await this.quickInput.selectQuickInputElement(0, keepOpen);
	}

	async openQuickOutline({ timeout = 30000 }): Promise<void> {
		await expect(async () => {
			// Open quick outline via keybinding
			await this.openQuickAccessWithRetry(QuickAccessKind.Symbols);

			// Get the quick input element text
			const text = await this.quickInput.waitForQuickInputElementText();

			// Log the status
			this.code.logger.log(`QuickAccess: Quick Outline returned text: "${text}"`);

			// Fail the retry if no symbols are found
			if (text === 'No symbol information for the file') {
				throw new Error('No symbol information for the file');
			}
		}).toPass({ timeout });
	}
}

