/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import { Action2, registerAction2 } from 'vs/platform/actions/common/actions';
import { localize } from 'vs/nls';
import * as nls from 'vs/nls';
import { URI } from 'vs/base/common/uri';
import { LanguageRuntimeCommandId, LANGUAGE_RUNTIME_ACTION_CATEGORY } from 'vs/workbench/contrib/languageRuntime/common/languageRuntime';
import { ILocalizedString } from 'vs/platform/action/common/action';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { Codicon } from 'vs/base/common/codicons';
import { INotebookKernelService } from 'vs/workbench/contrib/notebook/common/notebookKernelService';
import { IQuickInputService, IQuickPickItem } from 'vs/platform/quickinput/common/quickInput';

export function registerLanguageRuntimeActions() {
	const category: ILocalizedString = { value: LANGUAGE_RUNTIME_ACTION_CATEGORY, original: 'Language Runtime' };

	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: LanguageRuntimeCommandId.Select,
				title: { value: localize('workbench.action.language.runtime.select', "Select Active Language Runtime"), original: 'Select Active Language Runtime' },
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
			// Get all registered kernels. (TODO: This will eventually use the
			// language runtime service instead of relying on registered
			// notebook kernels)
			const kernelService = accessor.get(INotebookKernelService);
			const allKernels = kernelService.getMatchingKernel({
				uri: URI.parse('repl:any'),
				viewType: 'interactive'
			}).all;

			// Map to quick-pick items for user selection
			const selections = allKernels.map((k) => (<IQuickPickItem>{
				id: k.id,
				label: k.label,
				description: k.description
			}));

			// Prompt the user to select a kernel/runtime
			const pickService = accessor.get(IQuickInputService);
			const selection = await pickService.pick(selections, {
				canPickMany: false,
				placeHolder: nls.localize('language runtime placeholder', 'Select Language Runtime')
			});

			throw new Error('Seems like you wanted this one: ' + selection?.id);
		}
	});
}
