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
	const rLoadedPackagesTool = vscode.lm.registerTool<{}>('getAttachedRPackages', {
		invoke: async (options, token) => {
			const manager = RSessionManager.instance;
			const session = manager.getConsoleSession();
			if (!session) {
				return new vscode.LanguageModelToolResult([
					new vscode.LanguageModelTextPart('No active R session'),
				]);
			}
			const packages = await session.callMethod('get_attached_packages');
			if (packages instanceof Array) {
				const results = packages.map((pkg: string) => new vscode.LanguageModelTextPart(pkg));
				return new vscode.LanguageModelToolResult(results);
			} else {
				return new vscode.LanguageModelToolResult([
					new vscode.LanguageModelTextPart('Failed to retrieve attached packages'),
				]);
			}
		}
	});
	context.subscriptions.push(rLoadedPackagesTool);

	const rPackageVersionTool = vscode.lm.registerTool<{ packageName: string }>('getInstalledRPackageVersion', {
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

	const rListPackageHelpTopicsTool = vscode.lm.registerTool<{ packageName: string }>('listPackageHelpTopics', {
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

			const helpTopics = await session.callMethod('list_package_help_topics', options.input.packageName);
			if (helpTopics instanceof Array) {
				const results = helpTopics.map((topic: string) => new vscode.LanguageModelTextPart(JSON.stringify(topic)));
				return new vscode.LanguageModelToolResult(results);
			} else {
				return new vscode.LanguageModelToolResult([
					new vscode.LanguageModelTextPart('Failed to retrieve help topics'),
				]);
			}
		}
	});
	context.subscriptions.push(rListPackageHelpTopicsTool);

	const rListAvailableVignettesTool = vscode.lm.registerTool<{ packageName: string }>('listAvailableVignettes', {
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

			const vignettes = await session.callMethod('list_available_vignettes', options.input.packageName);
			if (vignettes instanceof Array) {
				const results = vignettes.map((vignette: string) => new vscode.LanguageModelTextPart(JSON.stringify(vignette)));
				return new vscode.LanguageModelToolResult(results);
			} else {
				return new vscode.LanguageModelToolResult([
					new vscode.LanguageModelTextPart('Failed to retrieve vignettes'),
				]);
			}
		}
	});
	context.subscriptions.push(rListAvailableVignettesTool);

	const rGetPackageVignetteTool = vscode.lm.registerTool<{ packageName: string; vignetteName: string }>('getPackageVignette', {
		invoke: async (options, token) => {
			const manager = RSessionManager.instance;
			const session = manager.getConsoleSession();
			if (!session) {
				return new vscode.LanguageModelToolResult([
					new vscode.LanguageModelTextPart('No active R session'),
				]);
			}

			if (!options.input.packageName || !options.input.vignetteName) {
				return new vscode.LanguageModelToolResult([
					new vscode.LanguageModelTextPart('Both package name and vignette name are required'),
				]);
			}

			const vignette = await session.callMethod('get_package_vignette', options.input.packageName, options.input.vignetteName);
			if (vignette) {
				return new vscode.LanguageModelToolResult([
					new vscode.LanguageModelTextPart(vignette.toString()),
				]);
			} else {
				return new vscode.LanguageModelToolResult([
					new vscode.LanguageModelTextPart('Failed to retrieve vignette'),
				]);
			}
		}
	});
	context.subscriptions.push(rGetPackageVignetteTool);

	const rGetHelpPageTool = vscode.lm.registerTool<{ packageName?: string; helpTopic: string }>('getHelpPage', {
		invoke: async (options, token) => {
			const manager = RSessionManager.instance;
			const session = manager.getConsoleSession();
			if (!session) {
				return new vscode.LanguageModelToolResult([
					new vscode.LanguageModelTextPart('No active R session'),
				]);
			}

			if (!options.input.helpTopic) {
				return new vscode.LanguageModelToolResult([
					new vscode.LanguageModelTextPart('Help topic is required'),
				]);
			}

			const helpPage = await session.callMethod('get_help_page', options.input.helpTopic, options.input.packageName);
			if (helpPage) {
				return new vscode.LanguageModelToolResult([
					new vscode.LanguageModelTextPart(helpPage.toString()),
				]);
			} else {
				return new vscode.LanguageModelToolResult([
					new vscode.LanguageModelTextPart('Failed to retrieve help page'),
				]);
			}
		}
	});
	context.subscriptions.push(rGetHelpPageTool);
}
