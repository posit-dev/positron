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

/**
 * Publishes the generated Positron command skills. Held in a mutable slot so it
 * can be torn down when AI is switched off and re-established when it returns.
 */
let skillRootRegistration: vscode.Disposable | undefined;

function aiEnabled(): boolean {
	// Default is `true`; only an explicit `false` disables.
	return vscode.workspace.getConfiguration().get<boolean>(AI_ENABLED_KEY) !== false;
}

/** Serializes {@link sync} so a rapid config toggle cannot race the file swap. */
let pending: Promise<void> = Promise.resolve();

function sync(context: vscode.ExtensionContext, log: vscode.LogOutputChannel): Promise<void> {
	pending = pending.then(() => syncNow(context, log));
	return pending;
}

/**
 * Bring the generated skill root in line with the current state: registered and
 * freshly generated when AI is enabled, removed when it is not. Never throws --
 * a generation failure leaves the assistant without this skill rather than
 * breaking activation.
 */
async function syncNow(context: vscode.ExtensionContext, log: vscode.LogOutputChannel): Promise<void> {
	if (!aiEnabled()) {
		skillRootRegistration?.dispose();
		skillRootRegistration = undefined;
		return;
	}
	if (typeof positron.ai?.registerAgentSkillRoot !== 'function') {
		log.debug('This Positron build cannot register skill roots; skills will not be published.');
		return;
	}

	const skillRoot = path.join(context.globalStorageUri.fsPath, 'skills');
	await fs.mkdir(skillRoot, { recursive: true });

	// Register the root before generating so it is present even on the first
	// launch, when the files are still being written. Once registered it stays
	// put across regenerations; only the files underneath change.
	if (!skillRootRegistration) {
		skillRootRegistration = positron.ai.registerAgentSkillRoot(skillRoot);
	}

	try {
		await generateSkills(context, log);
	} catch (error) {
		log.error(`Failed to generate command skills: ${error instanceof Error ? error.message : String(error)}`);
	}
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const log = vscode.window.createOutputChannel('Positron Skills', { log: true });
	context.subscriptions.push(log);
	context.subscriptions.push(new vscode.Disposable(() => {
		skillRootRegistration?.dispose();
		skillRootRegistration = undefined;
	}));

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

export function deactivate(): void {
	skillRootRegistration?.dispose();
	skillRootRegistration = undefined;
}
