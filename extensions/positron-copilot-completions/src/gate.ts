/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as positron from 'positron';
import * as vscode from 'vscode';
import minimatch from 'minimatch';

/** Positron's AI main switch. */
const AI_ENABLED_KEY = 'ai.enabled';

/** The provider catalog id for GitHub Copilot. */
const COPILOT_PROVIDER_ID = 'copilot';

/**
 * Tracks whether Copilot suggestions may be served: true only when Positron's
 * AI main switch (`ai.enabled`) is on and the provider catalog enables the
 * 'copilot' provider.
 *
 * The catalog enablement is read asynchronously and seeded to false, so a
 * Copilot provider disabled in providers.json never serves a suggestion during
 * the in-flight first read.
 */
export class CopilotSuggestionsGate implements vscode.Disposable {
	private readonly _disposables: vscode.Disposable[] = [];
	private readonly _onDidChange = new vscode.EventEmitter<void>();
	readonly onDidChange = this._onDidChange.event;

	private _providerEnabled = false;

	constructor(log: vscode.LogOutputChannel) {
		this._disposables.push(this._onDidChange);

		positron.ai.isProviderEnabled(COPILOT_PROVIDER_ID).then(
			enabled => {
				this._providerEnabled = enabled;
				this._onDidChange.fire();
			},
			err => {
				// Fail closed: leave Copilot suggestions off. A later enablement
				// change corrects it via the listener below.
				log.error(`Failed to read Copilot provider enablement; leaving suggestions disabled: ${err}`);
			}
		);

		this._disposables.push(
			positron.ai.onDidChangeProviderEnablement(e => {
				if (e.id === COPILOT_PROVIDER_ID) {
					this._providerEnabled = e.enabled;
					this._onDidChange.fire();
				}
			}),
			vscode.workspace.onDidChangeConfiguration(e => {
				if (e.affectsConfiguration(AI_ENABLED_KEY)) {
					this._onDidChange.fire();
				}
			}),
		);
	}

	/** Whether suggestions are allowed right now. Read live; never cached. */
	get allowed(): boolean {
		return vscode.workspace.getConfiguration().get<boolean>(AI_ENABLED_KEY) === true && this._providerEnabled;
	}

	dispose(): void {
		this._disposables.forEach(d => d.dispose());
	}
}

/**
 * Whether a document is excluded from all AI features by
 * `positron.assistant.aiExcludes`. Excluded documents are never sent to the
 * language server.
 */
export function isExcludedFromAI(uri: vscode.Uri): boolean {
	const patterns = vscode.workspace.getConfiguration('positron.assistant').get<string[]>('aiExcludes');
	if (!patterns || patterns.length === 0) {
		return false;
	}
	return patterns.some(pattern => pattern.includes('/')
		? minimatch(uri.path, pattern, { dot: true })
		: minimatch(path.basename(uri.path), pattern, { dot: true }));
}
