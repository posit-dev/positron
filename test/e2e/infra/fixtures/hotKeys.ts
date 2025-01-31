import { Code } from '../code';

export class HotKeys {
	constructor(private code: Code) { }


	async press(keys: string) {
		const modifierKey = process.platform === 'darwin' ? 'Meta' : 'Control';

		const updatedKeys = keys.replace('Cmd', modifierKey);
		await this.code.driver.page.keyboard.press(updatedKeys);
	}
}
