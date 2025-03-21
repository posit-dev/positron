/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { RSession } from './session.js';
import { RSessionManager } from './session-manager.js';

/**
 * Registers the R language model tool for handling R code-related operations.
 * @param context The extension context for registering disposables
 */
export function registerRLanguageModelTools(context: vscode.ExtensionContext): void {
	const rLoadedPackagesTool = vscode.lm.registerTool<{}>('getLoadedPackages', {
		invoke: async (options, token) => {
			const manager = RSessionManager.instance;
			const session = manager.getConsoleSession();
			if (!session) {
				return new vscode.LanguageModelToolResult([
					new vscode.LanguageModelTextPart('No active R session'),
				]);
			}
			const packages = await session.callMethod('get_loaded_packages');
			if (packages instanceof Array) {
				const results = packages.map((pkg: string) => new vscode.LanguageModelTextPart(pkg));
				return new vscode.LanguageModelToolResult(results);
			} else {
				return new vscode.LanguageModelToolResult([
					new vscode.LanguageModelTextPart('Failed to retrieve loaded packages'),
				]);
			}
		}
	});
	context.subscriptions.push(rLoadedPackagesTool);

	const rPackageVersionTool = vscode.lm.registerTool<{ packageName: string }>('getInstalledPackageVersion', {
		invoke: async (options, token) => {
			const manager = RSessionManager.instance;
			const session = manager.getConsoleSession();
			if (!session) {
				return new vscode.LanguageModelToolResult([
					new vscode.LanguageModelTextPart('No active R session'),
				]);
			}

			if (!options.input.packageName) {
				return new vscode.LanguageModelToolResult([
					new vscode.LanguageModelTextPart('Package name is required'),
				]);
			}

			const version = await session.callMethod('packageVersion', options.input.packageName, null);
			if (version === null) {
				return new vscode.LanguageModelToolResult([
					new vscode.LanguageModelTextPart(`NULL`),
				]);
			} else {
				return new vscode.LanguageModelToolResult([
					new vscode.LanguageModelTextPart(JSON.stringify(version)),
				]);
			}
		}
	});

	context.subscriptions.push(rPackageVersionTool);
}
