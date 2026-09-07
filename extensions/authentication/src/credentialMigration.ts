/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import {
	ANTHROPIC_AUTH_PROVIDER_ID,
	CUSTOM_PROVIDER_AUTH_PROVIDER_ID,
	DEEPSEEK_AUTH_PROVIDER_ID,
	GEMINI_AUTH_PROVIDER_ID,
	OPENAI_AUTH_PROVIDER_ID,
	POSIT_AUTH_PROVIDER_ID,
} from './constants';
import { getCachedCustomProviders } from './providerCatalog';
import { log } from './log';

/**
 * The extension that now owns credentials for the language-model providers, and
 * the command it registers to receive them.
 */
const ASSISTANT_EXTENSION_ID = 'posit.assistant';
const IMPORT_COMMAND = 'posit-assistant.importMigratedCredentials';

/** Set once the handoff has run, so it never runs twice. */
const MIGRATION_DONE_KEY = 'authentication.credentialHandoffCompleted';

/** Providers whose credentials this extension no longer owns. */
const MIGRATED_PROVIDER_IDS: readonly string[] = [
	ANTHROPIC_AUTH_PROVIDER_ID,
	OPENAI_AUTH_PROVIDER_ID,
	CUSTOM_PROVIDER_AUTH_PROVIDER_ID,
	GEMINI_AUTH_PROVIDER_ID,
	DEEPSEEK_AUTH_PROVIDER_ID,
];

/** The Posit AI Pass OAuth token keys, which are not API-key shaped. */
const POSIT_OAUTH_KEYS: readonly string[] = [
	'posit-ai.access_token',
	'posit-ai.refresh_token',
	'posit-ai.token_expiry',
];

interface StoredAccount {
	readonly id: string;
	readonly label: string;
}

/** One provider's credentials, as handed to the Assistant. */
export interface MigratedProvider {
	readonly providerId: string;
	readonly apiKeys: { readonly accountId: string; readonly label: string; readonly key: string }[];
	readonly oauth?: Record<string, string>;
}

/**
 * Hand the language-model providers' credentials to the Assistant once, so
 * moving their ownership does not sign the user out.
 *
 * Pushed to a command the Assistant registers rather than exposed as an export
 * the Assistant calls: `executeCommand` carries no caller identity, so a pull
 * API would hand these secrets to any extension that guessed its name. Pushing
 * lets this extension choose the recipient.
 */
export function registerCredentialExport(context: vscode.ExtensionContext): void {
	// Fire and forget: a failed handoff must not block activation, and the
	// providers it concerns are no longer registered here either way.
	void handoffCredentials(context).catch(err =>
		log.error(`Credential handoff failed: ${err}`)
	);
}

async function handoffCredentials(context: vscode.ExtensionContext): Promise<void> {
	if (context.globalState.get<boolean>(MIGRATION_DONE_KEY)) {
		return;
	}
	const assistant = vscode.extensions.getExtension(ASSISTANT_EXTENSION_ID);
	if (!assistant) {
		// Nothing to hand off to. Left unmarked so it retries once the
		// Assistant is installed.
		return;
	}

	// Both extensions activate on `onStartupFinished`, so the Assistant may not
	// have registered the import command yet. Activating it explicitly keeps the
	// handoff to the user's first launch; waiting for the next one would leave
	// them signed out until they restarted.
	if (!assistant.isActive) {
		await assistant.activate();
	}

	if (!(await vscode.commands.getCommands(true)).includes(IMPORT_COMMAND)) {
		log.info(`Credential handoff: ${ASSISTANT_EXTENSION_ID} has not registered ${IMPORT_COMMAND}; will retry next activation`);
		return;
	}

	const providers = await collectMigratedCredentials(context);
	if (providers.length > 0) {
		await vscode.commands.executeCommand(IMPORT_COMMAND, providers);
		await clearMigratedCredentials(context, providers);
		log.info(`Credential handoff: transferred ${providers.length} provider(s) to ${ASSISTANT_EXTENSION_ID}`);
	}

	await context.globalState.update(MIGRATION_DONE_KEY, true);
}

/**
 * Read every credential this extension holds for a migrated provider. Custom
 * entries are keyed by entry name, so they come from the catalog rather than a
 * fixed list.
 */
async function collectMigratedCredentials(
	context: vscode.ExtensionContext
): Promise<MigratedProvider[]> {
	const ids = [
		...MIGRATED_PROVIDER_IDS,
		...getCachedCustomProviders().map(provider => provider.id),
	];

	const collected: MigratedProvider[] = [];
	for (const providerId of ids) {
		const accounts = context.globalState.get<StoredAccount[]>(`auth.accounts.${providerId}`) ?? [];
		const apiKeys: MigratedProvider['apiKeys'] = [];
		for (const account of accounts) {
			const key = await context.secrets.get(`apiKey-${providerId}-${account.id}`);
			if (key) {
				apiKeys.push({ accountId: account.id, label: account.label, key });
			}
		}
		if (apiKeys.length > 0) {
			collected.push({ providerId, apiKeys });
		}
	}

	const oauth: Record<string, string> = {};
	for (const key of POSIT_OAUTH_KEYS) {
		const value = await context.secrets.get(key);
		if (value) {
			oauth[key] = value;
		}
	}
	if (Object.keys(oauth).length > 0) {
		collected.push({ providerId: POSIT_AUTH_PROVIDER_ID, apiKeys: [], oauth });
	}

	return collected;
}

/** Drop the handed-off secrets, so they live in exactly one store. */
async function clearMigratedCredentials(
	context: vscode.ExtensionContext,
	providers: readonly MigratedProvider[]
): Promise<void> {
	for (const provider of providers) {
		for (const { accountId } of provider.apiKeys) {
			await context.secrets.delete(`apiKey-${provider.providerId}-${accountId}`);
		}
		for (const key of Object.keys(provider.oauth ?? {})) {
			await context.secrets.delete(key);
		}
		await context.globalState.update(`auth.accounts.${provider.providerId}`, undefined);
		await context.globalState.update(`authentication.previouslySignedIn.${provider.providerId}`, undefined);
	}
}
