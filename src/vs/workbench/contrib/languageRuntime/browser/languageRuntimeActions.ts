/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { generateUuid } from 'vs/base/common/uuid';
import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { ILocalizedString } from 'vs/platform/action/common/action';
import { Action2, registerAction2 } from 'vs/platform/actions/common/actions';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { IQuickInputService, IQuickPickItem, IQuickPickSeparator } from 'vs/platform/quickinput/common/quickInput';
import { IKeybindingRule, KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { LANGUAGE_RUNTIME_ACTION_CATEGORY } from 'vs/workbench/contrib/languageRuntime/common/languageRuntime';
import { IPositronConsoleService } from 'vs/workbench/services/positronConsole/browser/interfaces/positronConsoleService';
import { ILanguageRuntimeMetadata, ILanguageRuntimeService, RuntimeCodeExecutionMode, RuntimeErrorBehavior } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { ILanguageRuntimeSession, IRuntimeClientInstance, IRuntimeSessionService, RuntimeClientType } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { ILanguageService } from 'vs/editor/common/languages/language';
import { groupBy } from 'vs/base/common/collections';
import { IRuntimeStartupService } from 'vs/workbench/services/runtimeStartup/common/runtimeStartupService';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { dispose } from 'vs/base/common/lifecycle';

// The category for language runtime actions.
const category: ILocalizedString = { value: LANGUAGE_RUNTIME_ACTION_CATEGORY, original: 'Interpreter' };

// Quick pick item interfaces.
interface LanguageRuntimeSessionQuickPickItem extends IQuickPickItem { session: ILanguageRuntimeSession }
interface LanguageRuntimeQuickPickItem extends IQuickPickItem { runtime: ILanguageRuntimeMetadata }
interface RuntimeClientTypeQuickPickItem extends IQuickPickItem { runtimeClientType: RuntimeClientType }
interface RuntimeClientInstanceQuickPickItem extends IQuickPickItem { runtimeClientInstance: IRuntimeClientInstance<any, any> }

/**
 * Helper function that askses the user to select a language from the list of registered language
 * runtimes.
 *
 * @param accessor The service accessor.
 * @returns The selected language quickpick item, or undefined, if the user canceled the operation.
 */
async function selectLanguage(accessor: ServicesAccessor) {
	const quickInputService = accessor.get(IQuickInputService);
	const languageRuntimeService = accessor.get(ILanguageRuntimeService);

	// TODO: Handle untrusted workspace - maybe error?

	return new Promise<IQuickPickItem | undefined>((resolve) => {
		const input = quickInputService.createQuickPick();

		const picks = new Map<string, IQuickPickItem>();
		const addRuntime = (runtimeMetadata: ILanguageRuntimeMetadata) => {
			if (!picks.has(runtimeMetadata.languageId)) {
				picks.set(runtimeMetadata.languageId, {
					id: runtimeMetadata.languageId,
					label: runtimeMetadata.languageName,
				});
				const sortedPicks = Array.from(picks.values()).sort((a, b) => a.label.localeCompare(b.label));
				input.items = sortedPicks;
			}
		};

		const disposables = [
			input,
			input.onDidAccept(() => {
				resolve(input.activeItems[0]);
				input.hide();
			}),
			input.onDidHide(() => {
				dispose(disposables);
				resolve(undefined);
			}),
			languageRuntimeService.onDidRegisterRuntime((runtimeMetadata) => {
				addRuntime(runtimeMetadata);
			}),
		];

		input.canSelectMany = false;
		input.placeholder = nls.localize('positron.executeCode.selectLanguage', 'Select the language to execute code in');

		for (const runtimeMetadata of languageRuntimeService.registeredRuntimes) {
			addRuntime(runtimeMetadata);
		}

		// TODO: Start with input.busy = true and set it to false when runtime discovery completes.

		input.show();
	});
}

/**
 * Helper function that asks the user to select a language runtime session from
 * an array of language runtime sessions.
 *
 * @param quickInputService The quick input service.
 * @param sessions The language runtime sessions the user can select from.
 * @param placeHolder The placeholder for the quick input.
 * @returns The runtime session the user selected, or undefined, if the user canceled the operation.
 */
export const selectLanguageRuntimeSession = async (
	quickInputService: IQuickInputService,
	sessions: ILanguageRuntimeSession[],
	placeHolder: string): Promise<ILanguageRuntimeSession | undefined> => {

	// Build the language runtime quick pick items.
	const sessionQuickPickItems = sessions.map<LanguageRuntimeSessionQuickPickItem>(session => ({
		id: session.sessionId,
		label: session.metadata.sessionName,
		description: session.runtimeMetadata.languageVersion,
		session
	} satisfies LanguageRuntimeSessionQuickPickItem));

	// Prompt the user to select a language runtime.
	const languageRuntimeQuickPickItem = await quickInputService
		.pick<LanguageRuntimeSessionQuickPickItem>(sessionQuickPickItems, {
			canPickMany: false,
			placeHolder
		});

	// Done.
	return languageRuntimeQuickPickItem?.session;
};

/**
 * Helper function that asks the user to select a registered language runtime for a language.
 *
 * @param accessor The service accessor.
 * @param languageId The language ID of the language runtimes to select from.
 *
 * @returns The language runtime the user selected, or undefined, if the user canceled the operation.
 */
const selectLanguageRuntime = async (
	accessor: ServicesAccessor,
	languageId: string,
	preferredRuntime: ILanguageRuntimeMetadata | undefined,
): Promise<ILanguageRuntimeMetadata | undefined> => {

	const quickInputService = accessor.get(IQuickInputService);
	const languageRuntimeService = accessor.get(ILanguageRuntimeService);
	const languageService = accessor.get(ILanguageService);

	// Prompt the user to select a language runtime.
	return new Promise((resolve) => {
		const input = quickInputService.createQuickPick<LanguageRuntimeQuickPickItem>();
		const runtimePicks = new Map<string, LanguageRuntimeQuickPickItem>();

		const addRuntime = (runtimeMetadata: ILanguageRuntimeMetadata) => {
			runtimePicks.set(runtimeMetadata.runtimeId, {
				id: runtimeMetadata.runtimeId,
				label: runtimeMetadata.runtimeName,
				description: runtimeMetadata.runtimePath,
				runtime: runtimeMetadata
			});

			// Update the quick pick items.
			const runtimePicksBySource = groupBy(Array.from(runtimePicks.values()), pick => pick.runtime.runtimeSource);
			const sortedSources = Object.keys(runtimePicksBySource).sort();
			const picks = new Array<IQuickPickSeparator | LanguageRuntimeQuickPickItem>();
			for (const source of sortedSources) {
				picks.push({ label: source, type: 'separator' }, ...runtimePicksBySource[source]);
			}
			input.items = picks;
		};

		const disposables = [
			input,
			input.onDidAccept(() => {
				resolve(input.activeItems[0]?.runtime);
				input.hide();
			}),
			input.onDidHide(() => {
				dispose(disposables);
				resolve(undefined);
			}),
			languageRuntimeService.onDidRegisterRuntime((runtimeMetadata) => {
				if (runtimeMetadata.languageId === languageId) {
					addRuntime(runtimeMetadata);
				}
			}),
		];

		input.canSelectMany = false;
		const languageName = languageService.getLanguageName(languageId);
		input.title = nls.localize('positron.languageRuntime.select.selectInterpreter', 'Select {0} Interpreter', languageName);
		input.placeholder = nls.localize('positron.languageRuntime.select.discoveringInterpreters', 'Discovering Interpreters...');
		input.matchOnDescription = true;

		for (const runtimeMetadata of languageRuntimeService.registeredRuntimes) {
			if (runtimeMetadata.languageId === languageId) {
				addRuntime(runtimeMetadata);
			}
		}

		if (preferredRuntime) {
			input.placeholder = nls.localize('positron.languageRuntime.select.selectedInterpreer', 'Selected Interpreter: {0}', preferredRuntime.runtimeName);
			const activeItem = runtimePicks.get(preferredRuntime.runtimeId);
			if (activeItem) {
				input.activeItems = [activeItem];
			}
		}

		input.show();

	});
};

/**
 * Helper function that asks the user to select a running language runtime, if no runtime is
 * currently marked as the active runtime.
 *
 * @param runtimeSessionService The runtime session service.
 * @param quickInputService The quick input service.
 * @param placeHolder The placeholder for the quick input.
 * @returns The language runtime the user selected, or undefined, if there are no running language runtimes or the user canceled the operation.
 */
const selectRunningLanguageRuntime = async (
	runtimeSessionService: IRuntimeSessionService,
	quickInputService: IQuickInputService,
	placeHolder: string): Promise<ILanguageRuntimeSession | undefined> => {

	// If there's an active language runtime, use that.
	const activeSession = runtimeSessionService.foregroundSession;
	if (activeSession) {
		return activeSession;
	}

	// If there isn't an active language runtime, but there are running
	// runtimes, ask the user to select one.
	const activeSessions = runtimeSessionService.activeSessions;
	if (!activeSessions.length) {
		alert('No interpreters are currently running.');
		return undefined;
	}

	// As the user to select the running language runtime.
	return await selectLanguageRuntimeSession(quickInputService, activeSessions, placeHolder);
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
	 * @param keybinding The keybinding for the action (optional)
	 */
	const registerLanguageRuntimeAction = (
		id: string,
		title: string,
		action: (accessor: ServicesAccessor) => Promise<void>,
		keybinding: Omit<IKeybindingRule, 'id'>[] | undefined = undefined): void => {
		registerAction2(class extends Action2 {
			// Constructor.
			constructor() {
				super({
					id,
					title: { value: title, original: title },
					f1: true,
					category,
					keybinding
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

	registerAction2(class PickInterpreterAction extends Action2 {
		constructor() {
			super({
				id: 'workbench.action.languageRuntime.pick',
				title: nls.localize2('positron.command.pickInterpreter', "Pick Interpreter"),
				f1: false,
				category,
			});
		}

		async run(accessor: ServicesAccessor, languageId: string) {
			const languageRuntime = await selectLanguageRuntime(accessor, languageId, undefined);
			return languageRuntime?.runtimeId;
		}
	});

	// Registers the start language runtime action.
	registerAction2(class SelectInterpreterAction extends Action2 {
		constructor() {
			super({
				id: 'workbench.action.languageRuntime.select',
				title: nls.localize2('positron.command.selectInterpreter', "Select Interpreter"),
				f1: false,
				category,
			});
		}

		async run(accessor: ServicesAccessor, languageId: string) {
			// Access services.
			const commandService = accessor.get(ICommandService);
			const runtimeSessionService = accessor.get(IRuntimeSessionService);
			const runtimeStartupService = accessor.get(IRuntimeStartupService);

			// Ask the user to select the language runtime to start. If they selected one, start it.
			let preferredRuntime: ILanguageRuntimeMetadata | undefined;
			try {
				preferredRuntime = runtimeStartupService.getPreferredRuntime(languageId);
			} catch {
				// getPreferredRuntime can error if a workspace-affiliated runtime is not
				// yet registered. Do nothing.
			}
			const languageRuntime = await selectLanguageRuntime(accessor, languageId, preferredRuntime);

			if (languageRuntime) {
				// Start the language runtime.
				runtimeSessionService.selectRuntime(languageRuntime.runtimeId, `'Select Interpreter' command invoked`);

				// Drive focus into the Positron console.
				commandService.executeCommand('workbench.panel.positronConsole.focus');
			}
		}
	});

	// Registers the set active language runtime action.
	registerLanguageRuntimeAction('workbench.action.languageRuntime.setActive', 'Set Active Interpreter', async accessor => {
		// Get the language runtime service.
		const runtimeSessionService = accessor.get(IRuntimeSessionService);

		// Have the user select the language runtime they wish to set as the active language runtime.
		const session = await selectRunningLanguageRuntime(
			runtimeSessionService,
			accessor.get(IQuickInputService),
			'Set the active language runtime');

		// If the user selected a language runtime, set it as the active language runtime.
		if (session) {
			runtimeSessionService.foregroundSession = session;
		}
	});

	// Registers the restart language runtime action.
	registerLanguageRuntimeAction('workbench.action.languageRuntime.restart', 'Restart Interpreter', async accessor => {
		// Access services.
		const consoleService = accessor.get(IPositronConsoleService);
		const runtimeSessionService = accessor.get(IRuntimeSessionService);

		// The runtime we'll try to restart.
		let session: ILanguageRuntimeSession | undefined = undefined;

		// Typically, the restart command should act on the language runtime
		// that's active in the Console, so try that first.
		const activeConsole = consoleService.activePositronConsoleInstance;
		if (activeConsole) {
			session = activeConsole.session;
		}

		// If there's no active console, try the active language runtime.
		if (!session) {
			session = runtimeSessionService.foregroundSession;
		}

		// If we still don't have an active language runtime, ask the user to
		// pick one.
		if (!session) {
			session = await selectRunningLanguageRuntime(
				runtimeSessionService,
				accessor.get(IQuickInputService),
				'Select the interpreter to restart');
			if (!session) {
				throw new Error('No interpreter selected');
			}
		}

		// Restart the language runtime.
		runtimeSessionService.restartSession(session.sessionId,
			`'Restart Interpreter' command invoked`);
	},
		[
			{
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Numpad0,
				secondary: [KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.F10]
			},
			{
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Digit0
			},
		]
	);

	// Registers the interrupt language runtime action.
	registerLanguageRuntimeAction('workbench.action.languageRuntime.interrupt', 'Interrupt Interpreter', async accessor => {
		(await selectRunningLanguageRuntime(
			accessor.get(IRuntimeSessionService),
			accessor.get(IQuickInputService),
			'Select the interpreter to interrupt'))?.interrupt();
	});

	// Registers the shutdown language runtime action.
	registerLanguageRuntimeAction('workbench.action.languageRuntime.shutdown', 'Shutdown Interpreter', async accessor => {
		(await selectRunningLanguageRuntime(
			accessor.get(IRuntimeSessionService),
			accessor.get(IQuickInputService),
			'Select the interpreter to shutdown'))?.shutdown();
	});

	// Registers the force quit language runtime action.
	registerLanguageRuntimeAction('workbench.action.languageRuntime.forceQuit', 'Force Quit Interpreter', async accessor => {
		(await selectRunningLanguageRuntime(
			accessor.get(IRuntimeSessionService),
			accessor.get(IQuickInputService),
			'Select the interpreter to force-quit'))?.forceQuit();
	});

	// Registers the show output language runtime action.
	registerLanguageRuntimeAction('workbench.action.languageRuntime.showOutput', 'Show interpreter output', async accessor => {
		(await selectRunningLanguageRuntime(
			accessor.get(IRuntimeSessionService),
			accessor.get(IQuickInputService),
			'Select the interpreter for which to show output'))?.showOutput();
	});

	registerLanguageRuntimeAction('workbench.action.languageRuntime.showProfile', 'Show interpreter profile report', async accessor => {
		(await selectRunningLanguageRuntime(
			accessor.get(IRuntimeSessionService),
			accessor.get(IQuickInputService),
			'Select the interpreter for which to show profile output'))?.showProfile();
	});

	registerLanguageRuntimeAction('workbench.action.language.runtime.openClient', 'Create Runtime Client Widget', async accessor => {
		// Access services.
		const runtimeSessionService = accessor.get(IRuntimeSessionService);
		const quickInputService = accessor.get(IQuickInputService);

		// Ask the user to select a running language runtime.
		const languageRuntime = await selectRunningLanguageRuntime(runtimeSessionService, quickInputService, 'Select the language runtime');
		if (!languageRuntime) {
			return;
		}

		// Prompt the user to select the runtime client type.
		const selection = await quickInputService.pick<RuntimeClientTypeQuickPickItem>([{
			id: generateUuid(),
			label: 'Environment Pane',
			runtimeClientType: RuntimeClientType.Variables,
		}], {
			canPickMany: false,
			placeHolder: `Select runtime client for ${languageRuntime.runtimeMetadata.runtimeName}`
		});

		// If the user selected a runtime client type, create the client for it.
		if (selection) {
			languageRuntime.createClient(selection.runtimeClientType, null);
		}
	});

	registerLanguageRuntimeAction('workbench.action.language.runtime.closeClient', 'Close Runtime Client Widget', async accessor => {
		// Access services.
		const runtimeSessionService = accessor.get(IRuntimeSessionService);
		const quickInputService = accessor.get(IQuickInputService);

		// Ask the user to select a running language runtime.
		const languageRuntime = await selectRunningLanguageRuntime(runtimeSessionService, quickInputService, 'Select the language runtime');
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
			placeHolder: nls.localize('Client Close Selection Placeholder', 'Close Client for {0}', languageRuntime.runtimeMetadata.runtimeName)
		});

		// If the user selected a runtime client instance, dispose it.
		if (selection) {
			selection.runtimeClientInstance.dispose();
		}
	});

	/**
	 * Arguments passed to the Execute Code actions.
	 */
	interface ExecuteCodeArgs {
		/**
		 * The language ID of the code to execute. This can be omitted, in which
		 * case the code will be assumed to be in whatever language is currently
		 * active in the console.
		 */
		langId: string | undefined;

		/**
		 * The code to execute.
		 */
		code: string;

		/**
		 * Whether to focus the console when executing the code. Defaults to false.
		 */
		focus: boolean | undefined;
	}

	/**
	 * Execute Code in Console: executes code as though the user had typed it
	 * into the console.
	 *
	 * Typically used to run code on the user's behalf; will queue the code to
	 * run after any currently running code, and will start a new console
	 * session if one is not already running.
	 */
	registerAction2(class ExecuteCodeInConsoleAction extends Action2 {

		constructor() {
			super({
				id: 'workbench.action.executeCode.console',
				title: nls.localize2('positron.command.executeCode.console', "Execute Code in Console"),
				f1: true,
				category
			});
		}

		/**
		 * Runs the Execute Code in Console action.
		 *
		 * @param accessor The service accessor.
		 */
		async run(accessor: ServicesAccessor, args: ExecuteCodeArgs | string | undefined) {
			const consoleService = accessor.get(IPositronConsoleService);
			const notificationService = accessor.get(INotificationService);
			const quickInputService = accessor.get(IQuickInputService);

			// TODO: Should this be in a "Developer: " command?
			// If no arguments are passed, prompt the user.
			if (!args) {
				// Prompt the user to select a language.
				const langPick = await selectLanguage(accessor);
				if (!langPick) {
					return;
				}

				// Prompt the user to enter the code to execute.
				const code = await quickInputService.input({
					value: '',
					placeHolder: 'Enter the code to execute',
					prompt: nls.localize('positron.executeCode.prompt', "Enter the code to execute in {0}", langPick.label),
				});
				if (!code) {
					return;
				}
				const escapedCode = code
					.replace(/\\n/g, '\n')
					.replace(/\\r/g, '\r');

				args = { langId: langPick.id, code: escapedCode, focus: false };
			}

			// If a single string argument is passed, assume it's the code to execute.
			if (typeof args === 'string') {
				args = { langId: undefined, code: args, focus: false };
			}

			// If no language ID is provided, try to get the language ID from
			// the active session.
			if (!args.langId) {
				const foreground = accessor.get(IRuntimeSessionService).foregroundSession;
				if (foreground) {
					args.langId = foreground.runtimeMetadata.languageId;
				} else {
					// Notify the user that there's no console for the language.
					notificationService.warn(nls.localize('positron.execute.noConsole.active', "Cannot execute '{0}'; no console is active."));
					return;
				}
			}

			// Execute the code in the console.
			consoleService.executeCode(
				args.langId, args.code, !!args.focus, true /* execute the code even if incomplete */);
		}
	});

	/**
	 * Execute Code Silently: executes code, but doesn't show it to the user.
	 *
	 * This action executes code immediately after the currently running command
	 * (if any) has finished. It has priority over the queue of pending console
	 * inputs from the user but still needs to wait until the current command is
	 * finished, which might take a long time.
	 *
	 * Any output (messages, warnings, or errors) generated by this command is
	 * discarded silently instead of being shown in the console.
	 *
	 * Typically used to for code that is executed for its side effects, rather
	 * than for its output. Doesn't auto-start sessions.
	 */
	registerAction2(class ExecuteSilentlyAction extends Action2 {
		private static _counter = 0;

		constructor() {
			super({
				id: 'workbench.action.executeCode.silently',
				title: nls.localize2('positron.command.executeCode.silently', "Execute Code Silently"),
				f1: false,
				category
			});
		}

		/**
		 * Runs the Execute Code Silently action.
		 *
		 * @param accessor The service accessor.
		 * @param languageId The language ID.
		 * @param code The code to execute.
		 */
		async run(accessor: ServicesAccessor, args: ExecuteCodeArgs | string) {
			const runtimeSessionService = accessor.get(IRuntimeSessionService);
			if (typeof args === 'string') {
				args = { langId: undefined, code: args, focus: false };
			}

			// Get the active session for the language.
			const session = args.langId ?
				runtimeSessionService.getConsoleSessionForLanguage(args.langId) :
				runtimeSessionService.foregroundSession;
			args.langId = args.langId || session?.runtimeMetadata.languageId;

			if (session) {
				// We already have a console session for the language, so
				// execute the code in it (silently)
				session.execute(args.code, `silent-command-${ExecuteSilentlyAction._counter++}`,
					RuntimeCodeExecutionMode.Silent,
					RuntimeErrorBehavior.Continue);
			} else {
				// No console session available. Since the intent is usually to
				// execute the task in the background, notify the user that
				// there's no console for the language rather than trying nto
				// start a new one (which can be very noisy)
				const notificationService = accessor.get(INotificationService);
				const languageService = accessor.get(ILanguageService);

				// Derive the user-friendly name for the language.
				const languageName = languageService.getLanguageName(args.langId!);

				// Notify the user that there's no console for the language.
				notificationService.warn(nls.localize('positron.executeSilent.noConsole.active', "Cannot execute '{0}'; no {1} console is active.", args.code, languageName));
			}
		}
	});
}
