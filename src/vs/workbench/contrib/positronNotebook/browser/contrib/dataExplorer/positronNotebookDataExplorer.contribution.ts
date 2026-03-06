/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../../nls.js';
import { URI } from '../../../../../../base/common/uri.js';
import { CommandsRegistry } from '../../../../../../platform/commands/common/commands.js';
import { ServicesAccessor } from '../../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../../../platform/notification/common/notification.js';
import { IRuntimeSessionService } from '../../../../../services/runtimeSession/common/runtimeSessionService.js';
import { IPositronDataExplorerService } from '../../../../../services/positronDataExplorer/browser/interfaces/positronDataExplorerService.js';
import { JsonRpcErrorCode, PositronCommError } from '../../../../../services/languageRuntime/common/positronBaseComm.js';

/**
 * Arguments for the open-from-inline command.
 */
interface OpenFromInlineArgs {
	commId: string;
	variablePath?: string[];
	notebookUri?: URI;
}

/**
 * Command: open a full data explorer from an inline notebook preview, reusing
 * an existing tab for the same variable when possible.
 */
CommandsRegistry.registerCommand(
	'positron-data-explorer.openFromInline',
	async (accessor: ServicesAccessor, args: OpenFromInlineArgs) => {
		const dataExplorerService = accessor.get(IPositronDataExplorerService);
		const runtimeSessionService = accessor.get(IRuntimeSessionService);
		const notificationService = accessor.get(INotificationService);
		const logService = accessor.get(ILogService);

		const { commId, variablePath, notebookUri } = args;

		// If we have a variable path, check for an existing full explorer
		// scoped to the notebook's session.
		if (variablePath && variablePath.length > 0 && notebookUri) {
			const session = runtimeSessionService.getNotebookSessionForNotebookUri(notebookUri);
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
);
