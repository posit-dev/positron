/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Code } from '../infra/code';
import { basename, isAbsolute } from 'path';
import { QuickInput } from './quickInput';
import test, { expect } from '@playwright/test';
import { Editors } from './editors';

enum QuickAccessKind {
	Files = 1,
	Commands,
	Symbols
}

export class QuickAccess {

	constructor(private code: Code, private editors: Editors, private quickInput: QuickInput) { }

	async openDataFile(path: string): Promise<void> {
		if (!isAbsolute(path)) {
			// we require absolute paths to get a single
			// result back that is unique and avoid hitting
			// the search process to reduce chances of
			// search needing longer.
			throw new Error('quickAccess.openFile requires an absolute path');
		}

		// quick access shows files with the basename of the path
		await this.openFileQuickAccessAndWait(path, basename(path));

		// open first element
		await this.quickInput.selectQuickInputElement(0);
	}

	async openFileQuickAccessAndWait(
		searchValue: string,
		expectedFirstElementNameOrExpectedResultCount: string | number
	): Promise<void> {
		// Clear editor history to ensure Quick Access is not "polluted"
		await this.runCommand('workbench.action.clearEditorHistory');

		if (this.code.driver.page.url().includes('8080')) {
			await this.code.driver.page.getByRole('button', { name: 'Clear', exact: true }).click();
		}

		await expect(async () => {
			// Open Quick Access and wait for the elements to appear
			await this.openQuickAccessWithRetry(QuickAccessKind.Files, searchValue);


			await this.quickInput.waitForQuickInputElements((elementNames) => {
				this.code.logger.log('QuickAccess: resulting elements:', elementNames);

				if (elementNames.length === 0) {
					this.code.logger.log('QuickAccess: No elements found, retrying...');
					return false; // Retry polling
				}

				const firstElementName = elementNames[0];

				// Check if "No matching results" appears
				if (firstElementName === 'No matching results') {
					this.code.logger.log(`QuickAccess: File search returned "No matching results", retrying...`);
					return false; // Retry polling
				}

				// Handle expected result count
				if (typeof expectedFirstElementNameOrExpectedResultCount === 'number') {
					if (elementNames.length === expectedFirstElementNameOrExpectedResultCount) {
						return true; // Condition met
					}
					this.code.logger.log(
						`QuickAccess: Expected ${expectedFirstElementNameOrExpectedResultCount} results, got ${elementNames.length}, retrying...`
					);
					return false;
				}

				// Handle expected first element name
				if (firstElementName === expectedFirstElementNameOrExpectedResultCount) {
					return true; // Condition met
				}

				this.code.logger.log(
					`QuickAccess: Expected first result '${expectedFirstElementNameOrExpectedResultCount}', got '${firstElementName}', retrying...`
				);
				return false;
			});
		}).toPass({
			timeout: 15000,
		});

		this.code.logger.log('QuickAccess: File search succeeded.');
	}

	async openFile(path: string, waitForFocus = true): Promise<void> {
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
		if (waitForFocus) {
			await this.editors.waitForActiveTab(fileName);
			await this.editors.selectTab(fileName);
		}
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
				await this.code.driver.page.keyboard.press('Escape');
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
		const stepWrapper = (label: string, fn: () => Promise<void>) => {
			try {
				// Check if running in a test context
				if (test.info().title) {
					return test.step(label, fn); // Use test.step if inside a test
				}
			} catch (e) {
				// Catch errors if not in a test context
			}
			return fn(); // Run directly if not in a test
		};

		await stepWrapper(`Run command: ${commandId}`, async () => {
			const keepOpen = options?.keepOpen;
			const exactLabelMatch = options?.exactLabelMatch;

			const openCommandPalletteAndTypeCommand = async (): Promise<boolean> => {
				await this.openQuickAccessWithRetry(QuickAccessKind.Commands, `>${commandId}`);
				const text = await this.quickInput.waitForQuickInputElementText();

				return !(text === 'No matching commands' || (exactLabelMatch && text !== commandId));
			};

			await expect(async () => {
				const hasCommandFound = await openCommandPalletteAndTypeCommand();
				if (!hasCommandFound) {
					this.code.logger.log(`QuickAccess: No matching commands, retrying...`);
					await this.quickInput.closeQuickInput();
					throw new Error(`Command not found: ${commandId}`);
				}
			}, `Run Command: ${commandId}`).toPass({
				timeout: 15000,
				intervals: [1000],
			});

			this.code.logger.log(`QuickAccess: ${commandId}  ✓ success`);
			await this.quickInput.selectQuickInputElement(0, keepOpen);
		});
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

