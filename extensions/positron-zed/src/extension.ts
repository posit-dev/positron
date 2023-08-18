/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { PositronZedLanguageRuntime } from './positronZedLanguageRuntime';

/**
 * Activates the extension.
 * @param context An ExtensionContext that contains the extention context.
 */
export function activate(context: vscode.ExtensionContext) {
	const generator = async function* getPositronZedLanguageRuntimes() {
		yield new PositronZedLanguageRuntime(
			context,
			'00000000-0000-0000-0000-000000000200',
			'2.0.0');
		yield new PositronZedLanguageRuntime(
			context,
			'00000000-0000-0000-0000-000000000100',
			'1.0.0');
		yield new PositronZedLanguageRuntime(
			context,
			'00000000-0000-0000-0000-000000000098',
			'0.98.0');
	};

	positron.runtime.registerLanguageRuntimeProvider('zed', generator());
}
