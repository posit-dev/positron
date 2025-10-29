/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// The code in extensions/open-remote-wsl has been adapted from https://github.com/jeanp413/open-remote-wsl,
// which is licensed under the MIT license.

import * as vscode from 'vscode';

class WSLTerminal {
	static NAME = 'WSL';

	private getTerminal() {
		const wslTerminal = vscode.window.terminals.find(t => t.name === WSLTerminal.NAME);
		if (wslTerminal) {
			return wslTerminal;
		}
		return vscode.window.createTerminal(WSLTerminal.NAME);
	}

	runCommand(command: string) {
		const wslTerminal = this.getTerminal();
		wslTerminal.show(false);
		wslTerminal.sendText(command, true);
	}
}

export default new WSLTerminal();
