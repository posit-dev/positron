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
import { ILanguageRuntime, ILanguageRuntimeService, RuntimeClientType } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { IsDevelopmentContext } from 'vs/platform/contextkey/common/contextkeys';

/**
 * Asks the user to select a language runtime.
 * @param quickInputService The quick input service.
 * @param languageRuntimes The language runtimes the user can select from.
 * @returns The language runtime the user selected, or undefined, if they canceled the operation.
 */
const askUserToSelectLanguageRuntime = async (quickInputService: IQuickInputService, languageRuntimes: ILanguageRuntime[]): Promise<ILanguageRuntime | undefined> => {
	// Build the quick pick items for available runtimes.
	const languageRuntimeQuickPickItems = languageRuntimes.map<IQuickPickItem & { languageRuntime: ILanguageRuntime }>(languageRuntime => {
		return {
			id: languageRuntime.metadata.id,
			label: languageRuntime.metadata.name,
			description: languageRuntime.metadata.version,
			languageRuntime
		};
	});

	// Prompt the user to select a kernel/runtime
	const languageRuntimeQuickPickItem = await quickInputService.pick(languageRuntimeQuickPickItems, {
		canPickMany: false,
		placeHolder: nls.localize('language runtime placeholder', 'Select Language Runtime')
	});

	// Done.
	return languageRuntimeQuickPickItem?.languageRuntime;
};

/**
 * Registers language runtime actions.
 */
export function registerLanguageRuntimeActions() {
	// The category for language runtime actions.
	const category: ILocalizedString = { value: LANGUAGE_RUNTIME_ACTION_CATEGORY, original: 'Language Runtime' };

	// Start Language Runtime.
	registerAction2(class extends Action2 {
		// Constructor.
		constructor() {
			super({
				id: LanguageRuntimeCommandId.Select,
				title: { value: nls.localize('workbench.action.language.runtime.start', "Start Language Runtime"), original: 'Start Language Runtime' },
				f1: true,
				category,
				icon: Codicon.plus,
				// TODO: Add 'keybinding' member with a default keybinding
				description: {
					description: 'workbench.action.language.runtime.start',
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
		 * Runs the action.
		 * @param accessor The service accessor.
		 */
		async run(accessor: ServicesAccessor) {
			// Retrieve services
			const extensionService = accessor.get(IExtensionService);
			const languageRuntimeService = accessor.get(ILanguageRuntimeService);
			const quickInputService = accessor.get(IQuickInputService);

			// Ensure that the python extension is loaded.
			await extensionService.activateByEvent('onLanguage:python');

			// Get the available language runtimes.
			const allLanguageRuntimes = languageRuntimeService.getAllRuntimes();
			if (!allLanguageRuntimes.length) {
				alert(nls.localize('positronNoInstalledRuntimes', "No language runtimes are currently installed."));
				return;
			}

			// Have the user select the the language runtime to start. If they selected one, start it.
			const languageRuntime = await askUserToSelectLanguageRuntime(quickInputService, allLanguageRuntimes);
			if (languageRuntime) {
				languageRuntimeService.startRuntime(languageRuntime.metadata.id);
			}
		}
	});

	// Shutdown Language Runtime.
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: LanguageRuntimeCommandId.Select,
				title: { value: nls.localize('workbench.action.language.runtime.shutdown', "Shutdown Language Runtime"), original: 'Shutdown Language Runtime' },
				f1: true,
				category,
				icon: Codicon.stop,
				// TODO: Add 'keybinding' member with a default keybinding
				description: {
					description: 'workbench.action.language.runtime.shutdown',
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
			const languageRuntimeService = accessor.get(ILanguageRuntimeService);
			const quickInputService = accessor.get(IQuickInputService);

			// Get the available language runtimes.
			const allLanguageRuntimes = languageRuntimeService.getActiveRuntimes();
			if (!allLanguageRuntimes.length) {
				alert(nls.localize('positronNoStartedRuntimes', "No language runtimes are currently started."));
				return;
			}

			// Have the user select the the language runtime to shutdown. If they selected one, shut it down.
			const languageRuntime = await askUserToSelectLanguageRuntime(quickInputService, allLanguageRuntimes);
			if (languageRuntime) {
				languageRuntime.shutdown();
			}
		}
	});

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
			const languageRuntimeService = accessor.get(ILanguageRuntimeService);
			const quickInputService = accessor.get(IQuickInputService);

			// Ensure that the python extension is loaded.
			await extensionService.activateByEvent('onLanguage:python');

			// Get the available language runtimes.
			const allLanguageRuntimes = languageRuntimeService.getAllRuntimes();
			if (!allLanguageRuntimes.length) {
				alert(nls.localize('positronNoInstalledRuntimes', "No language runtimes are currently installed."));
				return;
			}

			// Have the user select the the language runtime to start. If they selected one, start it.
			const languageRuntime = await askUserToSelectLanguageRuntime(quickInputService, allLanguageRuntimes);
			if (languageRuntime) {
				languageRuntimeService.startRuntime(languageRuntime.metadata.id);
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
			const languageRuntimeService = accessor.get(ILanguageRuntimeService);
			const quickInputService = accessor.get(IQuickInputService);

			// Get the active language runtimes.
			const activeLanguageRuntimes = languageRuntimeService.getActiveRuntimes();
			if (!activeLanguageRuntimes.length) {
				alert(nls.localize('positronNoActiveRuntimes', "No language runtimes are currently active."));
				return;
			}

			// Have the user select the the language runtime to interrupt. If they selected one, start it.
			const languageRuntime = await askUserToSelectLanguageRuntime(quickInputService, activeLanguageRuntimes);
			if (languageRuntime) {
				languageRuntime.interrupt();
			}
		}
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: LanguageRuntimeCommandId.Restart,
				title: { value: nls.localize('workbench.action.language.runtime.restart', "Restart Active Language Runtime"), original: 'Restart Active Language Runtime' },
				f1: true,
				category,
				icon: Codicon.refresh,
				// TODO: Add 'keybinding' member with a default keybinding
				description: {
					description: 'workbench.action.language.runtime.restart',
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
		 * Restarts the active language runtime
		 *
		 * @param accessor The service accessor.
		 */
		async run(accessor: ServicesAccessor) {
			// Retrieve services
			const languageRuntimeService = accessor.get(ILanguageRuntimeService);
			const quickInputService = accessor.get(IQuickInputService);

			// Get the active language runtimes.
			const activeLanguageRuntimes = languageRuntimeService.getActiveRuntimes();
			if (!activeLanguageRuntimes.length) {
				alert(nls.localize('positronNoActiveRuntimes', "No language runtimes are currently active."));
				return;
			}

			// Have the user select the the language runtime to interrupt. If they selected one, start it.
			const languageRuntime = await askUserToSelectLanguageRuntime(quickInputService, activeLanguageRuntimes);
			if (languageRuntime) {
				languageRuntime.restart();
			}
		}
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: LanguageRuntimeCommandId.OpenClient,
				title: { value: nls.localize('workbench.action.language.runtime.openClient', "Create New Runtime Client Widget"), original: 'Create New Runtime Client Widget' },
				f1: true,
				category,
				icon: Codicon.plus,
				precondition: IsDevelopmentContext,
				description: {
					description: 'workbench.action.language.runtime.openClient',
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
		 * Prompts the user to select a client to open
		 *
		 * @param accessor The service accessor.
		 */
		async run(accessor: ServicesAccessor) {
			// Retrieve services
			const languageRuntimeService = accessor.get(ILanguageRuntimeService);
			const pickService = accessor.get(IQuickInputService);

			// Get the list of available runtimes
			const runtimes = languageRuntimeService.getActiveRuntimes();

			// Ensure we got at least one
			if (runtimes.length < 1) {
				throw new Error('No language runtimes are currently active.');
			}

			// Select the first one
			const runtime = runtimes[0];

			// Map to quick-pick items for user selection
			const selections = [<IQuickPickItem>{
				id: RuntimeClientType.Environment,
				label: 'Environment Pane'
			}];

			// Prompt the user to select a client
			const selection = await pickService.pick(selections, {
				canPickMany: false,
				placeHolder: nls.localize('Client Open Selection Placeholder', 'Start Client for {0}', runtime.metadata.name)
			});

			// Find the kernel the user selected and register it
			if (selection) {
				runtime.createClient(selection.id as RuntimeClientType);
			}
		}
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: LanguageRuntimeCommandId.CloseClient,
				title: { value: nls.localize('workbench.action.language.runtime.closeClient', "Close Runtime Client Widget"), original: 'Close Runtime Client Widget' },
				f1: true,
				category,
				icon: Codicon.remove,
				precondition: IsDevelopmentContext,
				description: {
					description: 'workbench.action.language.runtime.closeClient',
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
		 * Prompts the user to select a client to close
		 *
		 * @param accessor The service accessor.
		 */
		async run(accessor: ServicesAccessor) {
			// Retrieve services
			const languageRuntimeService = accessor.get(ILanguageRuntimeService);
			const pickService = accessor.get(IQuickInputService);

			// Get the list of available runtimes
			const runtimes = languageRuntimeService.getActiveRuntimes();

			// Ensure we got at least one
			if (runtimes.length < 1) {
				throw new Error('No language runtimes are currently active.');
			}

			// Select the first one
			const runtime = runtimes[0];

			// Map to quick-pick items for user selection
			const clients = await runtime.listClients();

			if (clients.length < 1) {
				throw new Error(`No clients are currently open for ${runtime.metadata.name}`);
			}

			const selections = clients.map((client) => (<IQuickPickItem>{
				id: client.getClientId(),
				label: client.getClientType()
			}));

			// Prompt the user to select a client
			const selection = await pickService.pick(selections, {
				canPickMany: false,
				placeHolder: nls.localize('Client Close Selection Placeholder', 'Close Client for {0}', runtime.metadata.name)
			});

			// Find the kernel the user selected and close it
			if (selection) {
				for (const client of clients) {
					if (client.getClientId() === selection.id) {
						client.dispose();
					}
				}
			}
		}
	});
}
