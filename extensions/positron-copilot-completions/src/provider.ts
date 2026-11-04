/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { CopilotLanguageClient, SuggestItem, SuggestReason } from './client.js';
import { CopilotSuggestionsGate, isExcludedFromAI } from './gate.js';

/** How long the cursor must rest before asking for a next edit there. */
const CARET_MOVE_DELAY_MS = 300;

/** Carried in {@link vscode.InlineCompletionChangeHint.data} when we trigger a request ourselves. */
interface TriggerHint {
	reason: SuggestReason;
}

interface ShownSuggestion {
	kind: 'completion' | 'edit';
	item: SuggestItem;
}

/**
 * Serves ghost text and next edit suggestions from one
 * `textDocument/copilotSuggest` request: the server decides, per request,
 * whether a completion or a next edit wins.
 */
export class CopilotInlineCompletionProvider implements vscode.InlineCompletionItemProvider, vscode.Disposable {
	private readonly _disposables: vscode.Disposable[] = [];
	private readonly _suggestions = new WeakMap<vscode.InlineCompletionItem, ShownSuggestion>();

	private readonly _onDidChange = new vscode.EventEmitter<vscode.InlineCompletionChangeHint | void>();
	/** Lets us ask for a suggestion when the cursor moves or after an accept, not only on typing. */
	readonly onDidChange = this._onDidChange.event;

	private _caretMoveTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(
		private readonly _getClient: () => CopilotLanguageClient | undefined,
		private readonly _gate: CopilotSuggestionsGate,
		private readonly _log: vscode.LogOutputChannel,
	) {
		this._disposables.push(
			this._onDidChange,
			vscode.window.onDidChangeTextEditorSelection(e => {
				// Typing also moves the selection but reports no kind; only
				// deliberate moves (keyboard navigation, mouse clicks) count.
				if (e.kind === vscode.TextEditorSelectionChangeKind.Keyboard || e.kind === vscode.TextEditorSelectionChangeKind.Mouse) {
					clearTimeout(this._caretMoveTimer);
					this._caretMoveTimer = setTimeout(() => this.trigger('caretMove'), CARET_MOVE_DELAY_MS);
				}
			}),
		);
	}

	private trigger(reason: SuggestReason): void {
		const hint: TriggerHint = { reason };
		this._onDidChange.fire({ data: hint });
	}

	async provideInlineCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
		context: vscode.InlineCompletionContext,
		token: vscode.CancellationToken,
	): Promise<vscode.InlineCompletionList | undefined> {
		const copilot = this._getClient();
		if (!copilot?.client.isRunning() || !this._gate.allowed || isExcludedFromAI(document.uri)) {
			return undefined;
		}

		const editor = vscode.window.visibleTextEditors.find(e => e.document === document);
		const options: vscode.FormattingOptions = {
			tabSize: typeof editor?.options.tabSize === 'number' ? editor.options.tabSize : 4,
			insertSpaces: editor?.options.insertSpaces !== false,
		};
		const hint = context.changeHint?.data as TriggerHint | undefined;
		const reason: SuggestReason = hint?.reason
			?? (context.triggerKind === vscode.InlineCompletionTriggerKind.Invoke ? 'manual' : 'typing');

		const started = Date.now();
		let suggestion;
		try {
			suggestion = await copilot.suggest(document, position, reason, options, token);
		} catch (err) {
			if (!token.isCancellationRequested) {
				this._log.debug(`copilotSuggest failed: ${err}`);
			}
			return undefined;
		}
		this._log.trace(`copilotSuggest (${reason}) took ${Date.now() - started}ms: ${suggestion ? `${suggestion.kind}/${suggestion.presentation}` : 'none'}`);
		if (suggestion) {
			this._log.trace(`  at ${position.line}:${position.character} v${document.version}: ${JSON.stringify(suggestion)}`);
		}
		if (!suggestion || suggestion.items.length === 0) {
			return undefined;
		}

		// Jumps to other documents aren't rendered in this prototype.
		if (suggestion.target.uri !== copilot.client.code2ProtocolConverter.asUri(document.uri)) {
			return undefined;
		}

		const p2c = copilot.client.protocol2CodeConverter;
		const toItem = (si: SuggestItem) => new vscode.InlineCompletionItem(
			si.text,
			p2c.asRange(si.range),
			si.command ? p2c.asCommand(si.command) : undefined,
		);

		if (suggestion.kind === 'completion' && suggestion.presentation === 'ghostText') {
			const items = suggestion.items.map(si => {
				const item = toItem(si);
				this._suggestions.set(item, { kind: 'completion', item: si });
				return item;
			});
			return new vscode.InlineCompletionList(items);
		}

		if (suggestion.kind === 'edit' && suggestion.presentation === 'diff') {
			const si = suggestion.items[0];
			const item = toItem(si);
			item.isInlineEdit = true;
			item.showInlineEditMenu = true;
			this._suggestions.set(item, { kind: 'edit', item: si });
			return new vscode.InlineCompletionList([item]);
		}

		// Skip kinds and presentations we don't recognize, per the server docs.
		return undefined;
	}

	handleDidShowCompletionItem(completionItem: vscode.InlineCompletionItem, updatedInsertText: string): void {
		const shown = this._suggestions.get(completionItem);
		const copilot = this._getClient();
		this._log.trace(`shown: ${shown?.kind} ${JSON.stringify(updatedInsertText)}`);
		if (!shown || !copilot) {
			return;
		}
		if (shown.kind === 'completion') {
			copilot.didShowCompletion(shown.item, updatedInsertText);
		} else {
			copilot.didShowInlineEdit(shown.item);
		}
	}

	handleEndOfLifetime(completionItem: vscode.InlineCompletionItem, reason: vscode.InlineCompletionEndOfLifeReason): void {
		const shown = this._suggestions.get(completionItem);
		this._log.trace(`end of lifetime: ${shown?.kind} reason=${vscode.InlineCompletionEndOfLifeReasonKind[reason.kind]}`);
		if (reason.kind === vscode.InlineCompletionEndOfLifeReasonKind.Accepted) {
			// After an accept the next edit often follows directly.
			this.trigger('postAccept');
		}
	}

	handleDidPartiallyAcceptCompletionItem(completionItem: vscode.InlineCompletionItem, info: vscode.PartialAcceptInfo | number): void {
		const shown = this._suggestions.get(completionItem);
		if (shown?.kind === 'completion') {
			this._getClient()?.didPartiallyAcceptCompletion(shown.item, typeof info === 'number' ? info : info.acceptedLength);
		}
	}

	dispose(): void {
		clearTimeout(this._caretMoveTimer);
		this._disposables.forEach(d => d.dispose());
	}
}
