/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { isCodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { IMcpCallerContext, IPositronMcpService } from '../../../../platform/positronMcp/common/positronMcp.js';
import {
	buildUserContextResult,
	IMcpUserContextEditorState,
	IMcpUserContextStateSnapshot,
	parseUserContextArgs,
	truncateContextField,
} from '../../../../platform/positronMcp/common/positronMcpContext.js';
import { IMcpCallToolResult } from '../../../../platform/positronMcp/common/positronMcpTools.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { IPositronNotebookService } from '../../positronNotebook/browser/positronNotebookService.js';
import { PositronMcpNotebookTools } from './positronMcpNotebook.js';

/**
 * The get-user-context tool: what has the user been doing?
 *
 * Splits the answer along data ownership: the event half (recent console
 * executions, errors, the `since` filtering, attribution scoping) comes from
 * the main-process ledger via {@link IPositronMcpService.queryUserContext};
 * the state half (active session, focused editor, open notebooks) is read
 * live from this window's services. The pure composer in positronMcpContext
 * merges the two into the stable response shape.
 */
export class PositronMcpUserContextTool {
	constructor(
		private readonly _runtimeSessionService: IRuntimeSessionService,
		private readonly _editorService: IEditorService,
		private readonly _notebookService: IPositronNotebookService,
		private readonly _notebookTools: PositronMcpNotebookTools,
		private readonly _mcpService: IPositronMcpService,
	) { }

	async handle(args: Record<string, unknown>, caller: IMcpCallerContext | undefined): Promise<IMcpCallToolResult> {
		if (!caller) {
			// Every brokered call carries a caller; without one the ledger cannot
			// scope attribution, so refuse rather than leak another client's runs.
			throw new Error('get-user-context requires an MCP session context.');
		}
		const parsed = parseUserContextArgs(args);
		const data = await this._mcpService.queryUserContext({
			mcpSessionId: caller.mcpSessionId,
			since: parsed.since,
			maxConsoleEntries: parsed.maxConsoleEntries,
			include: [...parsed.include],
		});
		return buildUserContextResult(parsed, data, this._snapshot());
	}

	/** The live state of this window's session, editor, and notebooks. */
	private _snapshot(): IMcpUserContextStateSnapshot {
		const session = this._runtimeSessionService.foregroundSession;
		const instances = this._notebookService.listInstances();
		const activeNotebook = instances.length > 0 ? this._notebookTools.resolveNotebook() : undefined;
		return {
			session: session ? {
				name: session.dynState.sessionName,
				languageId: session.runtimeMetadata.languageId,
				languageVersion: session.runtimeMetadata.languageVersion,
				mode: session.metadata.sessionMode,
				sessionId: session.metadata.sessionId,
			} : null,
			editor: this._editorSnapshot(activeNotebook ? { path: activeNotebook.uri.fsPath } : undefined),
			notebooks: instances.map(instance => ({
				path: instance.uri.fsPath,
				isToolTarget: instance === activeNotebook,
			})),
		};
	}

	/**
	 * The focused document: path, language, cursor, and selection. Mirrors the
	 * get-active-document logic, including its notebook fallback -- a notebook
	 * is not a text editor, so with a notebook focused (or nothing else open)
	 * the section points at the notebook instead of reporting nothing.
	 */
	private _editorSnapshot(notebook: { path: string } | undefined): IMcpUserContextEditorState | null {
		const editor = this._editorService.activeTextEditorControl;
		const model = isCodeEditor(editor) ? editor.getModel() : null;
		if (!isCodeEditor(editor) || !model) {
			return notebook ? { path: notebook.path, kind: 'notebook' } : null;
		}
		const position = editor.getPosition();
		const selection = editor.getSelection();
		const selectionText = selection && !selection.isEmpty() ? model.getValueInRange(selection) : undefined;
		return {
			path: model.uri.fsPath,
			kind: 'text',
			languageId: model.getLanguageId(),
			cursor: position ? { line: position.lineNumber - 1, character: position.column - 1 } : undefined,
			selection: selection && !selection.isEmpty() && selectionText !== undefined ? {
				text: truncateContextField(selectionText, '\n[selection truncated]'),
				range: {
					start: { line: selection.startLineNumber - 1, character: selection.startColumn - 1 },
					end: { line: selection.endLineNumber - 1, character: selection.endColumn - 1 },
				},
			} : null,
		};
	}
}
