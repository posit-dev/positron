/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export interface IPositronInstallPackageArgs {
	packages: string[];
}

export class PositronInstallPackagesTool implements vscode.LanguageModelTool<IPositronInstallPackageArgs> {
	public static readonly toolName = 'installPythonPackage';

	async prepareInvocation(
		options: vscode.LanguageModelToolInvocationPrepareOptions<IPositronInstallPackageArgs>,
		_token: vscode.CancellationToken,
	): Promise<vscode.PreparedToolInvocation> {
		const packageNames = options.input.packages.join(', ');
		const result: vscode.PreparedToolInvocation = {
			// Display a generic command description rather than a specific pip command
			// The actual implementation uses environment-aware package management (pip, conda, poetry, etc.)
			// via the Python extension's installPackages command, not direct pip execution
			invocationMessage: `Install Python packages: ${packageNames}`,
			confirmationMessages: {
				title: vscode.l10n.t('Install Python Packages'),
				message: options.input.packages.length === 1
					? vscode.l10n.t('Positron Assistant wants to install the package {0}. Is this okay?', packageNames)
					: vscode.l10n.t('Positron Assistant wants to install the following packages: {0}. Is this okay?', packageNames)
			},
		};
		return result;
	}

	async invoke(
		options: vscode.LanguageModelToolInvocationOptions<IPositronInstallPackageArgs>,
		_token: vscode.CancellationToken,
	): Promise<vscode.LanguageModelToolResult> {
		try {
			// Use command-based communication - no API leakage
			const results = await vscode.commands.executeCommand(
				'python.installPackages',
				options.input.packages,
				{ requireConfirmation: false } // Chat handles confirmations
			);

			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart(Array.isArray(results) ? results.join('\n') : String(results))
			]);
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);

			// Parse error code prefixes from Python extension's installPackages command
			// Expected prefixes: [NO_INSTALLER], [VALIDATION_ERROR]
			// See: installPackages.ts JSDoc for complete error code documentation
			let assistantGuidance = '';

			if (errorMessage.startsWith('[NO_INSTALLER]')) {
				assistantGuidance = '\n\nSuggestion: The Python environment may not be properly configured. Ask the user to check their Python interpreter selection or create a new environment.';
			} else if (errorMessage.startsWith('[VALIDATION_ERROR]')) {
				assistantGuidance = '\n\nSuggestion: Check that the package names are correct and properly formatted.';
			} else {
				// Fallback for unexpected errors (network issues, permissions, etc.)
				assistantGuidance = '\n\nSuggestion: This may be a network, permissions, or environment issue. You can suggest the user retry the installation or try manual installation via terminal.';
			}

			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart(`Package installation encountered an issue: ${errorMessage}${assistantGuidance}`)
			]);
		}
	}
}
