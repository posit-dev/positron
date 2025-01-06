/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { Code } from '../code';
import { Editor } from './editor';
import { Editors } from './editors';
import { QuickAccess } from './quickaccess';

export class Settings {

	constructor(private code: Code, private editors: Editors, private editor: Editor, private quickaccess: QuickAccess) { }

	async addUserSettings(settings: [key: string, value: string][]): Promise<void> {
		await this.openUserSettingsFile();
		const file = 'settings.json';
		await this.code.driver.page.keyboard.press('ArrowRight');
		await this.editor.waitForTypeInEditor(file, settings.map(v => `"${v[0]}": ${v[1]},`).join(''));
		await this.editors.saveOpenedFile();
		await this.editors.waitForActiveTabNotDirty(file);
	}

	async clearUserSettings(): Promise<void> {
		await this.openUserSettingsFile();
		const file = 'settings.json';
		await this.quickaccess.runCommand('editor.action.selectAll');
		await this.code.driver.page.keyboard.press('Delete');
		await this.editor.waitForTypeInEditor(file, `{`); // will auto close }
		await this.editors.saveOpenedFile();
		await this.editors.waitForActiveTabNotDirty(file);
		await this.quickaccess.runCommand('workbench.action.closeActiveEditor');
	}

	async openUserSettingsFile(): Promise<void> {
		await this.quickaccess.runCommand('workbench.action.openSettingsJson');
		await this.editor.waitForEditorFocus('settings.json', 1);
	}
}
