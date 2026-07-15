/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { log } from '../log';
import {
	hasMigratableSettings,
	MigrationResult,
	runMigration,
	userProvidersFileIsPopulated,
} from './migrateToProvidersJson';

export const MIGRATE_COMMAND_ID = 'authentication.migrateSettingsToProvidersJson';
const PROMPT_DISMISSED_KEY = 'providersJsonMigrationPromptDismissed';

/** Registers the migration command and schedules the one-time prompt. */
export function registerProvidersJsonMigration(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.commands.registerCommand(MIGRATE_COMMAND_ID, () => runMigrationCommand())
	);
	// Fire-and-forget: never block activation on the prompt.
	maybePromptForMigration(context).catch(err =>
		log.error(`providers.json migration prompt failed: ${err}`)
	);
}

async function runMigrationCommand(): Promise<void> {
	if (!hasMigratableSettings()) {
		vscode.window.showInformationMessage(
			vscode.l10n.t('No provider settings to migrate.')
		);
		return;
	}

	let overwrite = false;
	if (await userProvidersFileIsPopulated()) {
		const overwriteAction = vscode.l10n.t('Overwrite');
		const choice = await vscode.window.showWarningMessage(
			vscode.l10n.t('~/.posit/ai/providers.json already contains provider configuration that Positron is using. Overwrite it with the values from your Positron settings?'),
			{ modal: true },
			overwriteAction
		);
		if (choice !== overwriteAction) {
			return;
		}
		overwrite = true;
	}

	await migrateAndReport({ overwrite });
}

async function maybePromptForMigration(context: vscode.ExtensionContext): Promise<void> {
	if (context.globalState.get<boolean>(PROMPT_DISMISSED_KEY)) {
		return;
	}
	if (!hasMigratableSettings()) {
		return;
	}
	if (await userProvidersFileIsPopulated()) {
		// Self-extinguishing: once providers.json is populated by any means,
		// the prompt never shows again.
		return;
	}

	const migrateAction = vscode.l10n.t('Migrate');
	const dontAskAction = vscode.l10n.t("Don't Ask Again");
	const choice = await vscode.window.showInformationMessage(
		vscode.l10n.t('Positron now stores AI provider and model configuration in ~/.posit/ai/providers.json. Migrate your settings to keep your providers and models working. Your existing settings will not be removed.'),
		migrateAction,
		dontAskAction
	);

	if (choice === migrateAction) {
		await migrateAndReport({ overwrite: false });
	} else if (choice === dontAskAction) {
		await context.globalState.update(PROMPT_DISMISSED_KEY, true);
	}
	// Plain dismissal: no flag, re-prompt on a later launch.
}

async function migrateAndReport(opts: { overwrite: boolean }): Promise<void> {
	let result: MigrationResult;
	try {
		result = await runMigration(opts);
	} catch (err) {
		log.error(`providers.json migration failed: ${err}`);
		vscode.window.showErrorMessage(
			vscode.l10n.t('Failed to migrate provider settings: {0}. No changes were made to your settings.', String(err))
		);
		return;
	}

	switch (result.outcome) {
		case 'migrated':
			vscode.window.showInformationMessage(
				vscode.l10n.t('Migrated {0} setting(s) to ~/.posit/ai/providers.json. Positron reads provider configuration from this file; your original settings were not removed.', result.settingCount)
			);
			break;
		case 'skipped-populated':
			vscode.window.showInformationMessage(
				vscode.l10n.t('providers.json already contains provider configuration; nothing was migrated.')
			);
			break;
		case 'nothing-to-migrate':
			vscode.window.showInformationMessage(
				vscode.l10n.t('No provider settings to migrate.')
			);
			break;
	}
}
