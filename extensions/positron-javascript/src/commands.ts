/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

import * as positron from 'positron';
import { JavaScriptLanguageRuntimeSession } from './session';

import fs = require('fs');
import path = require('path');

/**
 * Registers the extension's commands.
 *
 * @param context The extension context.
 */
export async function registerCommands(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.commands.registerCommand('javascript.startExtHostRuntime', () => {
			startExtHostRuntime(context);
		}));
}

// The runtime manager
let _manager: positron.LanguageRuntimeManager | undefined;

const runtimeId = '13C365D6-099A-43EC-934D-353ADEFD798F';

class JavascriptRuntimeManager implements positron.LanguageRuntimeManager {

	constructor(private readonly _context: vscode.ExtensionContext) {
	}

	discoverRuntimes(): AsyncGenerator<positron.LanguageRuntimeMetadata, any, unknown> {
		const version = process.version;

		const iconSvgPath = path.join(this._context.extensionPath, 'resources', 'nodejs-icon.svg');

		const runtimeShortName = version;
		const runtimeName = `Node.js ${runtimeShortName}`;

		return async function* () {
			const metadata: positron.LanguageRuntimeMetadata = {
				runtimePath: process.execPath,
				runtimeId,
				languageId: 'javascript',
				languageName: 'Node.js',
				runtimeName,
				runtimeShortName,
				runtimeSource: 'Node.js',
				languageVersion: version,
				base64EncodedIconSvg: fs.readFileSync(iconSvgPath).toString('base64'),
				runtimeVersion: '0.0.1',
				startupBehavior: positron.LanguageRuntimeStartupBehavior.Implicit,
				sessionLocation: positron.LanguageRuntimeSessionLocation.Browser,
				extraRuntimeData: {}
			};
			yield metadata;
		}();
	}

	createSession(
		runtimeMetadata: positron.LanguageRuntimeMetadata,
		sessionMetadata: positron.RuntimeSessionMetadata): Thenable<positron.LanguageRuntimeSession> {
		return Promise.resolve(new JavaScriptLanguageRuntimeSession(
			runtimeMetadata,
			sessionMetadata,
			this._context));
	}
}

function startExtHostRuntime(context: vscode.ExtensionContext): void {
	if (_manager) {
		positron.runtime.selectLanguageRuntime(runtimeId);
	} else {
		// Otherwise, try to create it
		try {
			_manager = new JavascriptRuntimeManager(context);
			context.subscriptions.push(
				positron.runtime.registerLanguageRuntimeManager(_manager));
			// Start the runtime on the next tick
			setTimeout(() => {
				positron.runtime.selectLanguageRuntime(runtimeId);
			}, 250);
		} catch (e) {
			console.error(e);
		}
	}
}
