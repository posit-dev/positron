/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import * as positron from 'positron';

import { generateSkills } from './skillGenerator';

/** The single AI main switch. Every AI feature is gated on this key. */
const AI_ENABLED_KEY = 'ai.enabled';

/** Downloads local docs so the assistant can use them. Off means no download. Defaults to on. */
const PREFETCH_DOCS_KEY = 'assistant.prefetchLocalDocs';

/** Kept clear of the eager-activation burst; long enough that startup settles first. */
const PREFETCH_DELAY_MS = 10_000;

/**
 * Publishes the generated Positron command skills. Held in a mutable slot so it
 * can be torn down when AI is switched off and re-established when it returns.
 */
let skillRootRegistration: vscode.Disposable | undefined;

function aiEnabled(): boolean {
	// Default is `true`; only an explicit `false` disables.
	return vscode.workspace.getConfiguration().get<boolean>(AI_ENABLED_KEY) !== false;
}

/**
 * Serializes {@link syncNow} so a rapid config toggle cannot race the file swap.
 * The chain always resolves -- {@link syncNow} never throws -- so one failed sync
 * cannot poison it and stop later toggles from re-syncing.
 */
let pending: Promise<void> = Promise.resolve();

function sync(context: vscode.ExtensionContext, log: vscode.LogOutputChannel): Promise<void> {
	pending = pending.then(() => syncNow(context, log));
	return pending;
}

/**
 * Bring the generated skill root in line with the current state: registered and
 * freshly generated when AI is enabled, removed when it is not. Never throws --
 * a failure leaves the assistant without this skill rather than breaking
 * activation or poisoning the {@link pending} chain.
 */
async function syncNow(context: vscode.ExtensionContext, log: vscode.LogOutputChannel): Promise<void> {
	try {
		if (!aiEnabled()) {
			// Only announce the teardown when there is one; a plain disabled launch
			// stays quiet rather than logging on every activation.
			if (skillRootRegistration) {
				disposeRegistration();
				log.info('AI is disabled; removed the command skill root.');
			}
			return;
		}

		const skillRoot = path.join(context.globalStorageUri.fsPath, 'skills');
		await fs.mkdir(skillRoot, { recursive: true });

		// Generate the skill files before registering the root. Registration fires
		// the change event consumers watch, so the directory must already be
		// populated when it lands or a consumer that scans on the event finds
		// nothing. Once registered the root stays put across regenerations.
		await generateSkills(context, log);

		if (!skillRootRegistration) {
			skillRootRegistration = positron.ai.registerAgentSkillRoot(skillRoot);
			log.info(`Registered command skill root at ${skillRoot}.`);
		}
	} catch (error) {
		// Keep the stack; it is the useful part when a sync fails.
		log.error(`Failed to sync command skills: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
	}
}

function disposeRegistration(): void {
	skillRootRegistration?.dispose();
	skillRootRegistration = undefined;
}

function prefetchEnabled(): boolean {
	// Default is `true`; only an explicit `false` opts out.
	return vscode.workspace.getConfiguration().get<boolean>(PREFETCH_DOCS_KEY) !== false;
}

/**
 * Warm the local docs cache so the first assistant docs need is served from
 * disk instead of paying for the download. Fire-and-forget: it runs only when
 * AI and the prefetch setting are enabled, never blocks activation, and swallows
 * its own failure since a missed prefetch just falls back to an on-demand fetch
 * later. A delay keeps the download clear of the eager-activation burst.
 *
 * Returns a disposable that cancels the pending timer if the extension is torn
 * down before it fires.
 */
function prefetchDocs(log: vscode.LogOutputChannel): vscode.Disposable {
	if (!aiEnabled() || !prefetchEnabled()) {
		return new vscode.Disposable(() => { });
	}
	const timer = setTimeout(() => {
		void (async () => {
			try {
				log.info(`Prefetching local docs in the background (delayed ${PREFETCH_DELAY_MS}ms after activation).`);
				const docs = await positron.docs.getLocalDocs();
				if (docs) {
					log.info(`Local docs prefetched to ${docs.path} (version ${docs.version}, profile ${docs.profile}, exact match ${docs.isExactMatch}).`);
				} else {
					log.info('Local docs prefetch found no docs to cache; the assistant will fall back to the web.');
				}
			} catch (error) {
				log.warn(`Local docs prefetch failed: ${error instanceof Error ? error.message : String(error)}`);
			}
		})();
	}, PREFETCH_DELAY_MS);
	return new vscode.Disposable(() => clearTimeout(timer));
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const log = vscode.window.createOutputChannel('Assistant Skills', { log: true });
	context.subscriptions.push(log);
	context.subscriptions.push(new vscode.Disposable(disposeRegistration));

	// Warm the docs cache in the background; does not block activation.
	context.subscriptions.push(prefetchDocs(log));

	// Re-sync when the AI main switch flips (it toggles without a reload).
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration(AI_ENABLED_KEY)) {
				void sync(context, log);
			}
		}),
	);

	await sync(context, log);
}
