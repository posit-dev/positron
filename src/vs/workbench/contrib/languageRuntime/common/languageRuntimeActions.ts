/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import { Action2, registerAction2 } from 'vs/platform/actions/common/actions';
import * as nls from 'vs/nls';
import { LanguageRuntimeCommandId, LANGUAGE_RUNTIME_ACTION_CATEGORY } from 'vs/workbench/contrib/languageRuntime/common/languageRuntime';
import { ILocalizedString } from 'vs/platform/action/common/action';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { Codicon } from 'vs/base/common/codicons';
import { IQuickInputService, IQuickPickItem } from 'vs/platform/quickinput/common/quickInput';
import { ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { ILogService } from 'vs/platform/log/common/log';

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
			const extensionService = accessor.get(IExtensionService);
			const languageService = accessor.get(ILanguageRuntimeService);
			const pickService = accessor.get(IQuickInputService);

			// ensure that the python extension is loaded
			await extensionService.activateByEvent('onLanguage:python');

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

	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: LanguageRuntimeCommandId.Interrupt,
				title: { value: nls.localize('workbench.action.language.runtime.interrupt', "Interrupt Active Language Runtime"), original: 'Interrupt Active Language Runtime' },
				f1: true,
				category,
				icon: Codicon.stop,
				// TODO: Add 'keybinding' member with a default keybinding
				description: {
					description: 'workbench.action.language.runtime.interrupt',
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
		 * Interrupts the active language runtime
		 *
		 * @param accessor The service accessor.
		 */
		async run(accessor: ServicesAccessor) {
			// Retrieve services
			const languageService = accessor.get(ILanguageRuntimeService);
			const logService = accessor.get(ILogService);

			const active = languageService.getActiveRuntimes();
			if (active.length < 1) {
				// Tell the user there are no active runtimes
				throw new Error('No language runtimes are active.');
			}

			// Interrupt the active runtime
			if (active.length > 1) {
				// TODO: It will be possible in the future for multiple runtimes
				// to be active at once. When this is true, we will need more
				// sophisiticated logic here; for example:
				//
				// - which runtime is currently in the busy state?
				// - which runtime is currently visible in on or more panes?
				//
				// For now, we'll just interrupt the first one.
				logService.warn('More than one language runtime is active. Interrupting only the first.');
			}

			// Interrupt the runtime
			active[0].interrupt();
		}
	});
}
