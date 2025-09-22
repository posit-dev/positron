/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as playwright from '@playwright/test';
import * as path from 'path';
import { test } from '@playwright/test';
import { Application } from '../../infra';

/**
 * Create file operation helpers for opening files and folders
 */
export function FileOperationsFixture(app: Application) {
	return {
		openFile: async (filePath: string, waitForFocus = true) => {
			await test.step(`Open file: ${path.basename(filePath)}`, async () => {
				await app.positron.quickaccess.openFile(path.join(app.workspacePathOrFolder, filePath), waitForFocus);
			});
		},

		openDataFile: async (filePath: string) => {
			await test.step(`Open data file: ${path.basename(filePath)}`, async () => {
				await app.positron.quickaccess.openDataFile(path.join(app.workspacePathOrFolder, filePath));
			});
		},

		openFolder: async (folderPath: string) => {
			await test.step(`Open folder: ${folderPath}`, async () => {
				await app.positron.hotKeys.openFolder();
				await playwright.expect(app.positron.quickInput.quickInputList.locator('a').filter({ hasText: '..' })).toBeVisible();

				const folderNames = folderPath.split('/');

				for (const folderName of folderNames) {
					const quickInputOption = app.positron.quickInput.quickInputResult.getByText(folderName);

					// Ensure we are ready to select the next folder
					const timeoutMs = 30000;
					const retryInterval = 2000;
					const maxRetries = Math.ceil(timeoutMs / retryInterval);

					for (let i = 0; i < maxRetries; i++) {
						try {
							await playwright.expect(quickInputOption).toBeVisible({ timeout: retryInterval });
							// Success — exit loop
							break;
						} catch (error) {
							// Press PageDown if not found
							await app.code.driver.page.keyboard.press('PageDown');

							// If last attempt, rethrow
							if (i === maxRetries - 1) {
								throw error;
							}
						}
					}

					await app.positron.quickInput.quickInput.pressSequentially(folderName + '/');

					// Ensure next folder is no longer visible
					await playwright.expect(quickInputOption).not.toBeVisible();
				}

				await app.positron.quickInput.clickOkButton();
			});
		}
	};
}
