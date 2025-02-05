import test, { Page } from '@playwright/test';

export enum Hotkeys {
	COPY = 'Cmd+C',
	PASTE = 'Cmd+V',
	CUT = 'Cmd+X',
	SELECT_ALL = 'Cmd+A',
	SAVE = 'Cmd+S',
	UNDO = 'Cmd+Z',
	OPEN_FILE = 'Cmd+O',
	FIND = 'Cmd+F',
	CLOSE_TAB = 'Cmd+W',
	FIRST_TAB = 'Cmd+1',
	SWITCH_TAB_LEFT = 'Cmd+Shift+[',
	SWITCH_TAB_RIGHT = 'Cmd+Shift+]',
	CLOSE_ALL_EDITORS = 'Cmd+K Cmd+W', // space indicates a sequence of keys
	VISUAL_MODE = 'Cmd+Shift+F4',
}

export class Keyboard {
	constructor(private page: Page) { }

	private getModifierKey(): string {
		return process.platform === 'darwin' ? 'Meta' : 'Control';
	}

	async hotKeys(action: Hotkeys) {
		await test.step(`Press hotkeys: ${action}`, async () => {
			const modifierKey = this.getModifierKey();

			// Split command if there are multiple sequential key presses
			const keySequences = action.split(' ').map(keys => keys.replace(/Cmd/g, modifierKey));

			for (const key of keySequences) {
				await this.page.keyboard.press(key);
			}
		})
	}

	async press(keys: string) {
		await this.page.keyboard.press(keys);
	}

	async type(text: string) {
		await this.page.keyboard.type(text);
	}
}

