/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { generateUuid } from 'vs/base/common/uuid';
import { ILocalizedString } from 'vs/platform/action/common/action';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { Action2, registerAction2 } from 'vs/platform/actions/common/actions';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { IQuickInputService, IQuickPickItem } from 'vs/platform/quickinput/common/quickInput';
import { LANGUAGE_RUNTIME_ACTION_CATEGORY } from 'vs/workbench/contrib/languageRuntime/common/languageRuntime';
import { ILanguageRuntime, ILanguageRuntimeService, IRuntimeClientInstance, RuntimeClientType } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

// The category for language runtime actions.
const category: ILocalizedString = { value: LANGUAGE_RUNTIME_ACTION_CATEGORY, original: 'Language Runtime' };

// Quick pick item interfaces.
interface LanguageRuntimeQuickPickItem extends IQuickPickItem { languageRuntime: ILanguageRuntime }
interface RuntimeClientTypeQuickPickItem extends IQuickPickItem { runtimeClientType: RuntimeClientType }
interface RuntimeClientInstanceQuickPickItem extends IQuickPickItem { runtimeClientInstance: IRuntimeClientInstance }

/**
 * Helper function that asks the user to select a language runtime from an array of language runtimes.
 * @param quickInputService The quick input service.
 * @param languageRuntimes The language runtimes the user can select from.
 * @param placeHolder The placeholder for the quick input.
 * @returns The language runtime the user selected, or undefined, if the user canceled the operation.
 */
export const selectLanguageRuntime = async (
	quickInputService: IQuickInputService,
	languageRuntimes: ILanguageRuntime[],
	placeHolder: string): Promise<ILanguageRuntime | undefined> => {

	// Build the language runtime quick pick items.
	const languageRuntimeQuickPickItems = languageRuntimes.map<LanguageRuntimeQuickPickItem>(languageRuntime => ({
		id: languageRuntime.metadata.runtimeId,
		label: languageRuntime.metadata.runtimeName,
		description: languageRuntime.metadata.languageVersion,
		languageRuntime
	} satisfies LanguageRuntimeQuickPickItem));

	// Prompt the user to select a language runtime.
	const languageRuntimeQuickPickItem = await quickInputService.pick<LanguageRuntimeQuickPickItem>(languageRuntimeQuickPickItems, {
		canPickMany: false,
		placeHolder
	});

	// Done.
	return languageRuntimeQuickPickItem?.languageRuntime;
};

/**
 * Helper function that asks the user to select a running language runtime.
 * @param languageRuntimeService The language runtime service.
 * @param quickInputService The quick input service.
 * @param placeHolder The placeholder for the quick input.
 * @returns The language runtime the user selected, or undefined, if there are no running language runtimes or the user canceled the operation.
 */
const selectRunningLanguageRuntime = async (
	languageRuntimeService: ILanguageRuntimeService,
	quickInputService: IQuickInputService,
	placeHolder: string): Promise<ILanguageRuntime | undefined> => {

	// Get the running language runtimes.
	const runningLanguageRuntimes = languageRuntimeService.runningRuntimes;
	if (!runningLanguageRuntimes.length) {
		alert('No language runtimes are currently running.');
		return undefined;
	}

	// As the user to select the running language runtime.
	return await selectLanguageRuntime(quickInputService, runningLanguageRuntimes, placeHolder);
};

/**
 * Registers language runtime actions.
 */
export function registerLanguageRuntimeActions() {
	/**
	 * Helper function to register a language runtime action.
	 * @param id The ID of the language runtime action.
	 * @param title The title of the language runtime action.
	 * @param action The action function to run.
	 */
	const registerLanguageRuntimeAction = (id: string, title: string, action: (accessor: ServicesAccessor) => Promise<void>): void => {
		registerAction2(class extends Action2 {
			// Constructor.
			constructor() {
				super({
					id,
					title: { value: title, original: title },
					f1: true,
					category,
					description: {
						description: id,
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
				await action(accessor);
			}
		});
	};

	// Registers the start language runtime action.
	registerLanguageRuntimeAction('workbench.action.languageRuntime.start', 'Start Language Runtime', async accessor => {
		// Access services.
		const commandService = accessor.get(ICommandService);
		const extensionService = accessor.get(IExtensionService);
		const languageRuntimeService = accessor.get(ILanguageRuntimeService);
		const quickInputService = accessor.get(IQuickInputService);

		// Ensure that the python extension is loaded.
		await extensionService.activateByEvent('onLanguage:python');

		// Get the registered language runtimes.
		const registeredRuntimes = languageRuntimeService.registeredRuntimes;
		if (!registeredRuntimes.length) {
			alert(nls.localize('positronNoInstalledRuntimes', "No language runtimes are currently installed."));
			return;
		}

		// Ask the user to select the language runtime to start. If they selected one, start it.
		const languageRuntime = await selectLanguageRuntime(quickInputService, registeredRuntimes, 'Select the language runtime to start');
		if (languageRuntime) {
			// Start the language runtime.
			languageRuntimeService.startRuntime(languageRuntime.metadata.runtimeId);

			// Drive focus into the Positron console.
			commandService.executeCommand('workbench.panel.positronConsole.focus');
		}
	});

	// Registers the set active  language runtime action.
	registerLanguageRuntimeAction('workbench.action.languageRuntime.setActive', 'Set Active Language Runtime', async accessor => {
		// Get the language runtime service.
		const languageRuntimeService = accessor.get(ILanguageRuntimeService);

		// Have the user select the language runtime they wish to set as the active language runtime.
		const runtime = await selectRunningLanguageRuntime(
			languageRuntimeService,
			accessor.get(IQuickInputService),
			'Set the active language runtime');

		// If the user selected a language runtime, set it as the active language runtime.
		if (runtime) {
			languageRuntimeService.activeRuntime = runtime;
		}
	});

	// Registers the restart language runtime action.
	registerLanguageRuntimeAction('workbench.action.languageRuntime.restart', 'Restart Language Runtime', async accessor => {
		(await selectRunningLanguageRuntime(
			accessor.get(ILanguageRuntimeService),
			accessor.get(IQuickInputService),
			'Select the language runtime to restart'))?.restart();
	});

	// Registers the interrupt language runtime action.
	registerLanguageRuntimeAction('workbench.action.languageRuntime.interrupt', 'Interrupt Language Runtime', async accessor => {
		(await selectRunningLanguageRuntime(
			accessor.get(ILanguageRuntimeService),
			accessor.get(IQuickInputService),
			'Select the language runtime to interrupt'))?.interrupt();
	});

	// Registers the shutdown language runtime action.
	registerLanguageRuntimeAction('workbench.action.languageRuntime.shutdown', 'Shutdown Language Runtime', async accessor => {
		(await selectRunningLanguageRuntime(
			accessor.get(ILanguageRuntimeService),
			accessor.get(IQuickInputService),
			'Select the language runtime to shutdown'))?.shutdown();
	});

	registerLanguageRuntimeAction('workbench.action.language.runtime.openClient', 'Create New Runtime Client Widget', async accessor => {
		// Access services.
		const languageRuntimeService = accessor.get(ILanguageRuntimeService);
		const quickInputService = accessor.get(IQuickInputService);

		// Ask the user to select a running language runtime.
		const languageRuntime = await selectRunningLanguageRuntime(languageRuntimeService, quickInputService, 'Select the language runtime');
		if (!languageRuntime) {
			return;
		}

		// Prompt the user to select the runtime client type.
		const selection = await quickInputService.pick<RuntimeClientTypeQuickPickItem>([{
			id: generateUuid(),
			label: 'Environment Pane',
			runtimeClientType: RuntimeClientType.Environment,
		}], {
			canPickMany: false,
			placeHolder: `Select runtime client for ${languageRuntime.metadata.runtimeName}`
		});

		// If the user selected a runtime client type, create the client for it.
		if (selection) {
			languageRuntime.createClient(selection.runtimeClientType, null);
		}
	});

	registerLanguageRuntimeAction('workbench.action.language.runtime.closeClient', 'Close Runtime Client Widget', async accessor => {
		// Access services.
		const languageRuntimeService = accessor.get(ILanguageRuntimeService);
		const quickInputService = accessor.get(IQuickInputService);

		// Ask the user to select a running language runtime.
		const languageRuntime = await selectRunningLanguageRuntime(languageRuntimeService, quickInputService, 'Select the language runtime');
		if (!languageRuntime) {
			return;
		}

		// Get the runtime client instances for the language runtime.
		const runtimeClientInstances = await languageRuntime.listClients();
		if (!runtimeClientInstances.length) {
			alert('No clients are currently started.');
			return;
		}

		// Create runtime client instance quick pick items.
		const runtimeClientInstanceQuickPickItems = runtimeClientInstances.map<RuntimeClientInstanceQuickPickItem>(runtimeClientInstance => ({
			id: generateUuid(),
			label: runtimeClientInstance.getClientType(),
			runtimeClientInstance,
		} satisfies RuntimeClientInstanceQuickPickItem));

		// Prompt the user to select a runtime client instance.
		const selection = await quickInputService.pick<RuntimeClientInstanceQuickPickItem>(runtimeClientInstanceQuickPickItems, {
			canPickMany: false,
			placeHolder: nls.localize('Client Close Selection Placeholder', 'Close Client for {0}', languageRuntime.metadata.runtimeName)
		});

		// If the user selected a runtime client instance, dispose it.
		if (selection) {
			selection.runtimeClientInstance.dispose();
		}
	});
}
