/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../base/common/uri.js';
import { localize } from '../../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { JsonRpcErrorCode, PositronCommError } from '../../../../services/languageRuntime/common/positronBaseComm.js';
import { InlineTableDataGridInstance } from '../../../../services/positronDataExplorer/browser/inlineTableDataGridInstance.js';
import { IPositronDataExplorerService } from '../../../../services/positronDataExplorer/browser/interfaces/positronDataExplorerService.js';
import { IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { IPositronNotebookCodeCell } from '../PositronNotebookCells/IPositronNotebookCell.js';
import { IPositronNotebookInstance } from '../IPositronNotebookInstance.js';

/**
 * Rich runtime context passed to actions registered against
 * {@link MenuId.PositronNotebookInlineDataExplorerHeader}. Built fresh on each
 * click by the inline data explorer renderer (notebook cells today, Quarto
 * documents in the future); closes over the current state at the moment the
 * user activates the menu item.
 *
 * The shape is surface-agnostic: required fields (`documentUri`,
 * `sourceLanguage`, etc.) come from any inline grid renderer, while
 * notebook-only fields (`cell`, `notebookInstance`) are optional so a Quarto
 * caller can leave them undefined. Actions that need notebook-specific state
 * (e.g. visualize, which inserts code into a cell) check for these and skip
 * when absent.
 *
 * Future direction: if this object grows further or a non-renderer caller
 * needs to invoke these actions, replace it with a lightweight key (commId or
 * document URI) and have actions look up the live inline-explorer instance
 * from a registry. That trades the closure-over-state ergonomics here for
 * call-site portability and a smaller serialized argument.
 */
export interface IInlineDataExplorerActionContext {
	/** URI of the document or notebook this output belongs to. */
	documentUri: URI;
	/** Language of the source code that produced this output (e.g. 'python', 'r'); '' if unknown. */
	sourceLanguage: string;
	commId: string;
	variablePath: string[] | undefined;
	title: string;
	shape: { rows: number; columns: number };
	gridInstance: InlineTableDataGridInstance | undefined;
	/** Notebook-only. Quarto and other surfaces leave undefined. */
	cell?: IPositronNotebookCodeCell;
	/** Notebook-only. Quarto and other surfaces leave undefined. */
	notebookInstance?: IPositronNotebookInstance;
}

export class OpenInDataExplorerAction extends Action2 {
	static readonly ID = 'positronNotebook.inlineDataExplorer.openInDataExplorer';

	constructor() {
		super({
			id: OpenInDataExplorerAction.ID,
			title: localize('openInDataExplorer', 'Open in Data Explorer'),
			icon: { id: 'go-to-file' },
			f1: false,
			menu: {
				id: MenuId.PositronNotebookInlineDataExplorerHeader,
				group: 'navigation',
				order: 20,
			},
		});
	}

	async run(accessor: ServicesAccessor, ctx: IInlineDataExplorerActionContext): Promise<void> {
		const dataExplorerService = accessor.get(IPositronDataExplorerService);
		const runtimeSessionService = accessor.get(IRuntimeSessionService);
		const notificationService = accessor.get(INotificationService);
		const logService = accessor.get(ILogService);

		const { commId, variablePath, documentUri } = ctx;

		// If we have a variable path, check for an existing full explorer
		// scoped to the document's session. (Quarto and other non-notebook
		// surfaces return no session here, so we fall through.)
		if (variablePath && variablePath.length > 0) {
			const session = runtimeSessionService.getNotebookSessionForNotebookUri(documentUri);
			if (session) {
				const existing = dataExplorerService.getInstanceForVariablePath(
					session.sessionId, variablePath
				);
				if (existing) {
					existing.requestFocus();
					return;
				}
			}
		}

		const instance = dataExplorerService.getInstance(commId);
		if (!instance) {
			notificationService.warn(
				localize('dataExplorerNotFound', 'Unable to open Data Explorer. Please re-run the cell.')
			);
			return;
		}

		try {
			// Request kernel to create a new, independent data explorer.
			// The kernel creates a new comm which auto-opens an editor tab.
			// Note: the RPC response may not arrive if the inline view
			// unmounts (disposing the comm) before the response is delivered.
			// This is expected -- the new editor tab opens regardless.
			await instance.dataExplorerClientInstance.openDataExplorer();
		} catch (error) {
			// The RPC may "fail" because the inline view's comm was disposed
			// before the response arrived (the new editor tab opening causes
			// the notebook to deactivate, unmounting the component). This is
			// fine -- the new editor tab was already created by the kernel.
			// Only show an error for genuine MethodNotFound failures, which
			// indicate the kernel doesn't support this method.
			const isMethodNotFound = (error as PositronCommError)?.code === JsonRpcErrorCode.MethodNotFound;
			if (isMethodNotFound) {
				notificationService.warn(
					localize('openDataExplorerNotSupported', 'Opening a full Data Explorer from inline view is not supported by this kernel.')
				);
			} else {
				// Expected race: the inline view's comm was disposed before the
				// RPC response arrived. The new editor tab was already created.
				logService.trace('openDataExplorer RPC error (benign comm-disposed race):', error);
			}
		}
	}
}

registerAction2(OpenInDataExplorerAction);
