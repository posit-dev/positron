/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import { Action2, registerAction2 } from 'vs/platform/actions/common/actions';
import * as nls from 'vs/nls';
import { LanguageRuntimeCommandId, LANGUAGE_RUNTIME_ACTION_CATEGORY } from 'vs/workbench/contrib/languageRuntime/common/languageRuntime';
import { ILocalizedString } from 'vs/platform/action/common/action';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { Codicon } from 'vs/base/common/codicons';
import { IQuickInputService, IQuickPickItem } from 'vs/platform/quickinput/common/quickInput';
import { ILanguageRuntimeService } from 'vs/workbench/contrib/languageRuntime/common/languageRuntimeService';

export function registerLanguageRuntimeActions() {
	const category: ILocalizedString = { value: LANGUAGE_RUNTIME_ACTION_CATEGORY, original: 'Language Runtime' };

	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: LanguageRuntimeCommandId.Select,
				title: { value: nls.localize('workbench.action.language.runtime.select', "Select Active Language Runtime"), original: 'Select Active Language Runtime' },
				f1: true,
				category,
				icon: Codicon.plus,
				// TODO: Add 'keybinding' member with a default keybinding
				description: {
					description: 'workbench.action.language.runtime.select',
					args: [{
						name: 'options',
						schema: {
							type: 'object'
						}
					}]
				}
			});
		}

		/**
		 * Prompts the user to select a language runtime
		 *
		 * @param accessor The service accessor.
		 */
		async run(accessor: ServicesAccessor) {
			// Retrieve services
			const languageService = accessor.get(ILanguageRuntimeService);
			const pickService = accessor.get(IQuickInputService);

			// Get the list of available runtimes
			const allRuntimes = languageService.getAllRuntimes();

			// Ensure we got at least one kernel to select from
			if (allRuntimes.length < 1) {
				throw new Error('No language runtimes are currently installed.');
			}

			// Map to quick-pick items for user selection
			const selections = allRuntimes.map((k) => (<IQuickPickItem>{
				id: k.metadata.id,
				label: k.metadata.name,
				description: k.metadata.version
			}));

			// Prompt the user to select a kernel/runtime
			const selection = await pickService.pick(selections, {
				canPickMany: false,
				placeHolder: nls.localize('language runtime placeholder', 'Select Language Runtime')
			});

			// Find the kernel the user selected and register it
			if (selection) {
				for (let i = 0; i < allRuntimes.length; i++) {
					const runtime = allRuntimes[i];
					if (selection.id === runtime.metadata.id) {
						// Start the runtime if there aren't any active
						if (languageService.getActiveRuntimes().length < 1) {
							languageService.startRuntime(runtime.metadata.id);
						}
						break;
					}
				}
			}
		}
	});
}
