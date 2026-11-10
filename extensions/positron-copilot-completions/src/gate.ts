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

const AI_EXCLUDES_KEY = 'positron.assistant.aiExcludes';
/** Deprecated predecessor of {@link AI_EXCLUDES_KEY}, honored as a migration aid. */
const INLINE_COMPLETION_EXCLUDES_KEY = 'positron.assistant.inlineCompletionExcludes';

/**
 * Which documents are excluded from all AI features. Excluded documents are
 * never sent to the language server.
 *
 * Mirrors core's `isFileExcludedFromAI` (chat/browser/tools/utils.ts): reads
 * `positron.assistant.aiExcludes`, falling back to the deprecated
 * `positron.assistant.inlineCompletionExcludes` only when the user set that
 * one and not `aiExcludes`. Patterns without a '/' match the basename.
 *
 * The patterns are compiled once and recompiled when either setting changes,
 * since the check runs on every keystroke.
 */
export class AIExclusions implements vscode.Disposable {
	private readonly _disposables: vscode.Disposable[] = [];
	private readonly _onDidChange = new vscode.EventEmitter<void>();
	/** Fires after the patterns change, once {@link isExcluded} reflects them. */
	readonly onDidChange = this._onDidChange.event;

	private _matchers: { basenameOnly: boolean; matcher: minimatch.IMinimatch }[] = [];

	constructor() {
		this._matchers = AIExclusions.compile();
		this._disposables.push(
			this._onDidChange,
			vscode.workspace.onDidChangeConfiguration(e => {
				if (e.affectsConfiguration(AI_EXCLUDES_KEY) || e.affectsConfiguration(INLINE_COMPLETION_EXCLUDES_KEY)) {
					this._matchers = AIExclusions.compile();
					this._onDidChange.fire();
				}
			}),
		);
	}

	private static compile(): { basenameOnly: boolean; matcher: minimatch.IMinimatch }[] {
		const config = vscode.workspace.getConfiguration();
		// `inspect` separates user-written values from the contributed default.
		// An empty array is still a user value ("exclude nothing").
		const aiInspect = config.inspect<string[]>(AI_EXCLUDES_KEY);
		const inlineInspect = config.inspect<string[]>(INLINE_COMPLETION_EXCLUDES_KEY);
		const aiSetByUser = aiInspect?.globalValue !== undefined || aiInspect?.workspaceValue !== undefined;
		const inlineSetByUser = inlineInspect?.globalValue !== undefined || inlineInspect?.workspaceValue !== undefined;
		const patterns = config.get<string[]>(!aiSetByUser && inlineSetByUser ? INLINE_COMPLETION_EXCLUDES_KEY : AI_EXCLUDES_KEY) ?? [];
		return patterns.map(pattern => ({
			basenameOnly: !pattern.includes('/'),
			matcher: new minimatch.Minimatch(pattern, { dot: true }),
		}));
	}

	/** Whether the document at `uri` is excluded from AI features. */
	isExcluded(uri: vscode.Uri): boolean {
		if (this._matchers.length === 0) {
			return false;
		}
		const basename = path.posix.basename(uri.path);
		return this._matchers.some(({ basenameOnly, matcher }) => matcher.match(basenameOnly ? basename : uri.path));
	}

	dispose(): void {
		this._disposables.forEach(d => d.dispose());
	}
}
