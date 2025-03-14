/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { execSync } from 'child_process';
import path from 'path';
import { Application } from '../../../infra/index.js';


export const deletePositronHistoryFiles = async (): Promise<void> => {
	const buildSet = !!process.env.BUILD;

	const homeDir = process.env.HOME || '';

	let vscodePath: string;
	let positronPath: string;
	if (buildSet) {
		vscodePath = path.join(homeDir, '.vscode');
		if (process.platform === 'darwin') { // for local debug
			positronPath = path.join(homeDir, 'Library/Application\ Support/Positron');
		} else { // linux, test not planned for Windows yet
			positronPath = path.join(homeDir, '.config/Positron');
		}
		console.log(`Release, vscodePath: ${vscodePath}, positronPath: ${positronPath}`);
	} else {
		vscodePath = path.join(homeDir, '.vscode-oss-dev');
		positronPath = path.join(homeDir, '.positron-dev');
		console.log(`Dev, vscodePath: ${vscodePath}, positronPath: ${positronPath}`);
	}

	execSync(`rm -rf ${vscodePath} ${positronPath}`);
};

export const getPrimaryInterpretersText = async (app: Application): Promise<string[]> => {

	await app.workbench.interpreter.openInterpreterDropdown();

	const primaryInterpreters = await app.code.driver.page.locator('.primary-interpreter').all();

	const interpretersText: string[] = [];
	for (const interpreter of primaryInterpreters) {
		const text = await interpreter.textContent();
		if (text) {
			interpretersText.push(text);
		}
	}

	await app.code.driver.page.keyboard.press('Escape');

	return interpretersText;
};
