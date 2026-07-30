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

/** Registers the migration command and runs the one-time automatic migration. */
export function registerProvidersJsonMigration(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.commands.registerCommand(MIGRATE_COMMAND_ID, () => runMigrationCommand())
	);
	// Fire-and-forget: never block activation on the migration.
	maybeAutoMigrate().catch(err =>
		log.error(`providers.json automatic migration failed: ${err}`)
	);
}

async function runMigrationCommand(): Promise<void> {
	log.info('[migration] Manual migration command invoked');
	if (!hasMigratableSettings()) {
		log.info('[migration] No migratable provider settings; nothing to do');
		vscode.window.showInformationMessage(
			vscode.l10n.t('No provider settings to migrate.')
		);
		return;
	}

	let overwrite = false;
	if (await userProvidersFileIsPopulated()) {
		log.info('[migration] providers.json is already populated; prompting to overwrite');
		const overwriteAction = vscode.l10n.t('Overwrite');
		const choice = await vscode.window.showWarningMessage(
			vscode.l10n.t('~/.posit/ai/providers.json already contains provider configuration that Positron is using. Overwrite it with the values from your Positron settings?'),
			{ modal: true },
			overwriteAction
		);
		if (choice !== overwriteAction) {
			log.info('[migration] User declined the overwrite; aborting');
			return;
		}
		log.info('[migration] User confirmed the overwrite');
		overwrite = true;
	}

	await migrateAndReport({ overwrite });
}

async function maybeAutoMigrate(): Promise<void> {
	if (!hasMigratableSettings()) {
		log.debug('[migration] Auto-migration: no migratable provider settings; skipping');
		return;
	}
	if (await userProvidersFileIsPopulated()) {
		// Self-extinguishing: once providers.json is populated by any means,
		// migration never runs again.
		log.debug('[migration] Auto-migration: providers.json already populated; skipping');
		return;
	}

	log.info('[migration] Auto-migration: migratable settings found and providers.json is empty; migrating');
	await migrateAndReport({ overwrite: false });
}

async function migrateAndReport(opts: { overwrite: boolean }): Promise<void> {
	let result: MigrationResult;
	try {
		result = await runMigration(opts);
	} catch (err) {
		const detail = formatMigrationError(err);
		// The toast shows the concise detail; the log also carries the stack for
		// real errors so a failure is diagnosable. Zod errors are skipped here:
		// their stack is noise and the flattened detail is already the useful part.
		const stack = err instanceof Error && !isZodLikeError(err) ? `\n${err.stack}` : '';
		log.error(`providers.json migration failed: ${detail}${stack}`);
		vscode.window.showErrorMessage(
			vscode.l10n.t('Failed to migrate provider settings: {0}. No changes were made to your settings.', detail)
		);
		return;
	}

	log.info(`[migration] Migration finished with outcome: ${result.outcome}`);
	switch (result.outcome) {
		case 'migrated': {
			const viewFileAction = vscode.l10n.t('View File');
			const showLogAction = vscode.l10n.t('Show Log');
			const choice = await vscode.window.showInformationMessage(
				vscode.l10n.t('Migrated {0} setting(s) to ~/.posit/ai/providers.json. Positron now reads Posit Assistant providers from this file; your original settings were not removed.', result.settingCount),
				viewFileAction,
				showLogAction
			);
			if (choice === viewFileAction) {
				log.info('[migration] Opening providers.json in an editor');
				const { PROVIDERS_CONFIG_PATH } = await import('ai-config/node');
				const doc = await vscode.workspace.openTextDocument(PROVIDERS_CONFIG_PATH);
				await vscode.window.showTextDocument(doc);
			} else if (choice === showLogAction) {
				log.show();
			}
			break;
		}
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

/** A Zod-style validation error: a list of per-field issues. */
interface ZodLikeError {
	issues: Array<{ message: string; path?: unknown[] }>;
}

function isZodLikeError(err: unknown): err is ZodLikeError {
	return !!err && typeof err === 'object' && Array.isArray((err as ZodLikeError).issues);
}

/**
 * Render a migration failure as a concise message. Schema validation throws a
 * Zod error whose issues pinpoint the offending fields (e.g. an empty model
 * name); flatten those to `path: message` pairs instead of the verbose default
 * dump. Any other error falls back to its string form.
 */
function formatMigrationError(err: unknown): string {
	if (isZodLikeError(err)) {
		return err.issues
			.map(issue => `${issue.path?.join('.') ?? ''}: ${issue.message}`)
			.join('; ');
	}
	return String(err);
}
