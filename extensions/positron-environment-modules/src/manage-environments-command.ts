/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { EnvironmentModulesApi } from './api.js';
import { ModuleEnvironmentConfig, ModuleSystemInfo } from './types.js';
import { listAvailableModules } from './module-listing.js';
import { log } from './extension.js';

/**
 * Handle the "Manage Module Environments" command
 */
export async function manageEnvironmentsCommand(api: EnvironmentModulesApi): Promise<void> {
	// Check if module system is available
	const systemInfo = await api.getModuleSystemInfo();

	if (!systemInfo.available) {
		// Show message explaining no module system is installed
		await vscode.window.showWarningMessage(
			vscode.l10n.t('No environment module system (such as Lmod or Environment Modules) was detected on this machine. Module environments require a module system to be installed.')
		);
		return;
	}

	// Get all configured environments
	const config = vscode.workspace.getConfiguration('positron.environmentModules');
	const environments = config.get<Record<string, ModuleEnvironmentConfig>>('environments', {});

	// Build QuickPick items
	const items: vscode.QuickPickItem[] = [];

	for (const [name, envConfig] of Object.entries(environments)) {
		const discoveredRuntimes = api.getDiscoveredRuntimes(name);
		const runtimeCount = discoveredRuntimes.length;
		const modules = envConfig.modules.join(', ');
		const languages = envConfig.languages.join(', ');

		items.push({
			label: name,
			description: modules,
			detail: vscode.l10n.t('{0} discovered interpreters', runtimeCount)
		});
	}

	// Add "Create New" option
	items.push({
		label: vscode.l10n.t('$(add) Create New Module Environment'),
		description: vscode.l10n.t('Define a new module environment configuration'),
		alwaysShow: true
	});

	// Show QuickPick
	const selected = await vscode.window.showQuickPick(items, {
		title: vscode.l10n.t('Manage Module Environments'),
		placeHolder: vscode.l10n.t('Select an environment to view details, or create a new one')
	});

	if (!selected) {
		return;
	}

	// Handle selection
	if (selected.label.includes('Create New')) {
		await createNewEnvironmentWizard(api, systemInfo);
	} else {
		await showEnvironmentDetails(api, selected.label, environments[selected.label]);
	}
}

/**
 * Show details for an existing module environment
 */
async function showEnvironmentDetails(
	api: EnvironmentModulesApi,
	name: string,
	config: ModuleEnvironmentConfig
): Promise<void> {
	const discoveredRuntimes = api.getDiscoveredRuntimes(name);

	// Build the message
	const languages = config.languages.join(', ');
	const modules = config.modules.join(', ');

	let interpretersList = vscode.l10n.t('No interpreters discovered yet');
	if (discoveredRuntimes.length > 0) {
		interpretersList = discoveredRuntimes
			.map((r: { interpreterPath: string; language: string }) => `  ${r.interpreterPath} (${r.language})`)
			.join('\n');
	}

	const message = vscode.l10n.t(
		'{0}\n\nLanguages: {1}\nModules: {2}\n\nDiscovered Interpreters:\n{3}',
		name,
		languages,
		modules,
		interpretersList
	);

	await vscode.window.showInformationMessage(message, { modal: true });
}

/**
 * Walk the user through creating a new module environment
 */
async function createNewEnvironmentWizard(
	api: EnvironmentModulesApi,
	systemInfo: ModuleSystemInfo
): Promise<void> {
	// Step 1: Get environment name
	const name = await vscode.window.showInputBox({
		title: vscode.l10n.t('Create Module Environment - Step 1 of 3'),
		prompt: vscode.l10n.t('Enter a name for this module environment (for display purposes only)'),
		placeHolder: vscode.l10n.t('e.g., python-3.11-env'),
		validateInput: (value) => {
			if (!value || value.trim().length === 0) {
				return vscode.l10n.t('Name is required');
			}
			// Check for existing environment with same name
			const config = vscode.workspace.getConfiguration('positron.environmentModules');
			const environments = config.get<Record<string, ModuleEnvironmentConfig>>('environments', {});
			if (environments[value.trim()]) {
				return vscode.l10n.t('An environment with this name already exists');
			}
			return undefined;
		}
	});

	if (!name) {
		return; // User cancelled
	}

	// Step 2: Choose target languages
	// Supported languages for module environments
	const supportedLanguages = ['python', 'r'];

	const languageItems: vscode.QuickPickItem[] = supportedLanguages.map(lang => ({
		label: lang,
		picked: false
	}));

	const selectedLanguages = await vscode.window.showQuickPick(languageItems, {
		title: vscode.l10n.t('Create Module Environment - Step 2 of 3'),
		placeHolder: vscode.l10n.t('Select target languages for this environment'),
		canPickMany: true
	});

	if (!selectedLanguages || selectedLanguages.length === 0) {
		return; // User cancelled or selected nothing
	}

	const languages = selectedLanguages.map(item => item.label);

	// Step 3: Choose modules to load
	const availableModules = await listAvailableModules(systemInfo);

	if (availableModules.length === 0) {
		vscode.window.showWarningMessage(
			vscode.l10n.t('No modules available. Please check your module system configuration.')
		);
		return;
	}

	const moduleItems: vscode.QuickPickItem[] = availableModules.map(mod => ({
		label: mod,
		picked: false
	}));

	const selectedModules = await vscode.window.showQuickPick(moduleItems, {
		title: vscode.l10n.t('Create Module Environment - Step 3 of 3'),
		placeHolder: vscode.l10n.t('Select modules to load (in order of selection)'),
		canPickMany: true
	});

	if (!selectedModules || selectedModules.length === 0) {
		return; // User cancelled or selected nothing
	}

	const modules = selectedModules.map(item => item.label);

	// Save the new environment to settings
	const saved = await saveNewEnvironment(name.trim(), languages, modules);

	// Only trigger discovery and show success if save succeeded
	if (saved) {
		// Trigger runtime discovery
		await vscode.commands.executeCommand('workbench.action.language.runtime.discoverAllRuntimes');
	}
}

/**
 * Save a new environment configuration to settings
 * @returns true if saved successfully (with appropriate user notification), false otherwise
 */
async function saveNewEnvironment(
	name: string,
	languages: string[],
	modules: string[]
): Promise<boolean> {
	const config = vscode.workspace.getConfiguration('positron.environmentModules');
	const environments = config.get<Record<string, ModuleEnvironmentConfig>>('environments', {});

	// Add the new environment
	environments[name] = { languages, modules };

	// Try to update at the User level first, fall back to Workspace if that fails
	try {
		await config.update('environments', environments, vscode.ConfigurationTarget.Global);
		// Show success notification for global save
		vscode.window.showInformationMessage(
			vscode.l10n.t("Module environment '{0}' was added successfully.", name)
		);
		return true;
	} catch (error) {
		log.warn(`Failed to save module environment '${name}' to user settings: ${error instanceof Error ? error.message : String(error)}`);
		// If Global fails (common in web/server mode), try Workspace
		try {
			await config.update('environments', environments, vscode.ConfigurationTarget.Workspace);
			vscode.window.showInformationMessage(
				vscode.l10n.t("Module environment '{0}' was saved to workspace settings (user settings not available in this environment): {1}", name, error instanceof Error ? error.message : String(error))
			);
			return true;
		} catch (workspaceError) {
			// If both fail, show error
			vscode.window.showErrorMessage(
				vscode.l10n.t("Failed to save module environment '{0}': {1}", name, workspaceError instanceof Error ? workspaceError.message : String(workspaceError))
			);
			return false;
		}
	}
}
