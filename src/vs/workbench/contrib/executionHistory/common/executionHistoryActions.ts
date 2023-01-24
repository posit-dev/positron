/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from 'vs/base/common/codicons';
import Severity from 'vs/base/common/severity';
import { localize } from 'vs/nls';
import { ILocalizedString } from 'vs/platform/action/common/action';
import { Action2, registerAction2 } from 'vs/platform/actions/common/actions';
import { IDialogService } from 'vs/platform/dialogs/common/dialogs';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { IExecutionHistoryService } from 'vs/workbench/contrib/executionHistory/common/executionHistoryService';
import { IReplService } from 'vs/workbench/contrib/repl/common/repl';
import { REPL_ACTION_CATEGORY } from 'vs/workbench/contrib/repl/common/replCommands';
import { ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

export function registerHistoryActions() {
	const category: ILocalizedString = { value: REPL_ACTION_CATEGORY, original: 'REPL' };

	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: 'workbench.action.inputHistory.clear',
				title: { value: localize('workbench.action.inputHistory.clear', "Clear Input History"), original: 'Clear Input History' },
				f1: true,
				category,
				icon: Codicon.clearAll
			});
		}

		/**
		 * Runs the input history clear command.
		 *
		 * @param accessor The service accessor.
		 * @param options The options for the new REPL instance.
		 */
		async run(accessor: ServicesAccessor) {
			// Use the service accessor to get the services we need.
			const historyService = accessor.get(IExecutionHistoryService);
			const languageRuntimeService = accessor.get(ILanguageRuntimeService);
			const dialogService = accessor.get(IDialogService);
			const replService = accessor.get(IReplService);

			// If there's no active language runtime, then we can't clear the
			// history, since we don't know which language to clear history for.
			const languageRuntime = languageRuntimeService.activeRuntime;
			if (!languageRuntime) {
				dialogService.show(
					Severity.Info,
					localize('noLanguageRuntime', "Cannot clear input history because no interpreter is currently active."));
				return;
			}

			const languageName = languageRuntime.metadata.languageName;

			// Ask the user if they want to clear the history; this is a
			// destructive action and it can't be undone.
			const result = await dialogService.confirm({
				message: localize('clearInputHistory', "Are you sure you want to clear the {0} input history? This can't be undone.", languageName),
				primaryButton: localize('clear', "Clear")
			});
			if (!result.confirmed) {
				return;
			}

			// Clear the stored history from the history service.
			historyService.clearInputEntries(languageRuntime.metadata.languageId);

			// Clear the history from the REPL service.
			replService.clearInputHistory(languageRuntime.metadata.languageId);

			// Let the user know that the history was cleared.
			dialogService.show(Severity.Info, localize('clearedInputHistory', "The {0} input history has been cleared.", languageName));
		}
	});
}
