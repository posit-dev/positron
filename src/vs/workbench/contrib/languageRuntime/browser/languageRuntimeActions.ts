/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from '../../../../nls.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { ILocalizedString } from '../../../../platform/action/common/action.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IQuickInputService, IQuickPickItem, IQuickPickSeparator, QuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import { IKeybindingRule, KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { LANGUAGE_RUNTIME_ACTION_CATEGORY } from '../common/languageRuntime.js';
import { CodeAttributionSource, IConsoleCodeAttribution, IPositronConsoleService, POSITRON_CONSOLE_VIEW_ID } from '../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { ILanguageRuntimeMetadata, ILanguageRuntimeService, LanguageRuntimeSessionMode, RuntimeCodeExecutionMode, RuntimeErrorBehavior, RuntimeState } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession, IRuntimeClientInstance, IRuntimeSessionService, RuntimeClientType, RuntimeStartMode } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { groupBy } from '../../../../base/common/collections.js';
import { IRuntimeStartupService } from '../../../services/runtimeStartup/common/runtimeStartupService.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { dispose } from '../../../../base/common/lifecycle.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { ExplorerFolderContext } from '../../files/common/files.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { localize } from '../../../../nls.js';
import { USE_POSITRON_MULTIPLE_CONSOLE_SESSIONS_CONFIG_KEY } from '../../../services/runtimeSession/common/positronMultipleConsoleSessionsFeatureFlag.js';

// The category for language runtime actions.
const category: ILocalizedString = { value: LANGUAGE_RUNTIME_ACTION_CATEGORY, original: 'Interpreter' };

// Quick pick item interfaces.
interface LanguageRuntimeQuickPickItem extends IQuickPickItem { runtime: ILanguageRuntimeMetadata }
interface RuntimeClientTypeQuickPickItem extends IQuickPickItem { runtimeClientType: RuntimeClientType }
interface RuntimeClientInstanceQuickPickItem extends IQuickPickItem { runtimeClientInstance: IRuntimeClientInstance<any, any> }

// Action IDs
export const LANGUAGE_RUNTIME_OPEN_ACTIVE_SESSIONS_ID = 'workbench.action.language.runtime.openActivePicker';
export const LANGUAGE_RUNTIME_START_SESSION_ID = 'workbench.action.language.runtime.openStartPicker';

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
	accessor: ServicesAccessor,
	options?: {
		placeholder?: string;
		allowStartSession?: boolean;
	}): Promise<ILanguageRuntimeSession | undefined> => {

	// Constants
	const startNewRuntimeId = generateUuid();

	// Access services.
	const quickInputService = accessor.get(IQuickInputService);
	const runtimeSessionService = accessor.get(IRuntimeSessionService);
	const commandService = accessor.get(ICommandService);

	// Create quick pick items for active console sessions sorted by creation time, oldest to newest.
	const sortedActiveSessions = runtimeSessionService.activeSessions
		.filter(session => session.metadata.sessionMode === LanguageRuntimeSessionMode.Console)
		.sort((a, b) => a.metadata.createdTimestamp - b.metadata.createdTimestamp);

	const activeRuntimeItems: IQuickPickItem[] = sortedActiveSessions.filter(
		(session) => {
			switch (session.getRuntimeState()) {
				case RuntimeState.Initializing:
				case RuntimeState.Starting:
				case RuntimeState.Ready:
				case RuntimeState.Idle:
				case RuntimeState.Busy:
				case RuntimeState.Restarting:
				case RuntimeState.Exiting:
				case RuntimeState.Offline:
				case RuntimeState.Interrupting:
					return true;
				default:
					return false;
			}
		}
	).map(
		(session) => {
			const isForegroundSession =
				session.sessionId === runtimeSessionService.foregroundSession?.sessionId;
			return {
				id: session.sessionId,
				label: session.metadata.sessionName,
				detail: session.runtimeMetadata.runtimePath,
				description: isForegroundSession ? 'Currently Selected' : undefined,
				iconPath: {
					dark: URI.parse(`data:image/svg+xml;base64, ${session.runtimeMetadata.base64EncodedIconSvg}`),
				},
				picked: isForegroundSession,
			};
		}
	);

	// Show quick pick to select an active runtime or show all runtimes.
	const quickPickItems: QuickPickItem[] = [
		{
			label: localize('positron.languageRuntime.activeSessions', 'Active Sessions'),
			type: 'separator',
		},
		...activeRuntimeItems,
		{
			type: 'separator'
		}
	];

	if (options?.allowStartSession) {
		quickPickItems.push({
			label: localize('positron.languageRuntime.newSession', 'New Session...'),
			id: startNewRuntimeId,
			alwaysShow: true
		});
	}
	const result = await quickInputService.pick(quickPickItems, {
		title: localize('positron.languageRuntime.selectSession', 'Select a Session'),
		canPickMany: false,
		activeItem: activeRuntimeItems.filter(item => item.picked)[0]
	});

	// Handle the user's selection.
	if (result?.id === startNewRuntimeId) {
		// If the user selected "All Runtimes...", execute the command to show all runtimes.
		const sessionId: string | undefined = await commandService.executeCommand(LANGUAGE_RUNTIME_START_SESSION_ID);
		if (sessionId) {
			return runtimeSessionService.activeSessions.find(session => session.sessionId === sessionId);
		}
	} else if (result?.id) {
		const session = runtimeSessionService.activeSessions
			.find(session => session.sessionId === result.id);
		return session;
	}
	return undefined;
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
		const input = quickInputService.createQuickPick<LanguageRuntimeQuickPickItem>(
			{ useSeparators: true }
		);
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
 * @param accessor The service accessor.
 * @param placeholder The placeholder for the quick input.
 * @returns The language runtime the user selected, or undefined, if there are no running language runtimes or the user canceled the operation.
 */
const selectRunningLanguageRuntime = async (
	accessor: ServicesAccessor,
	placeholder: string): Promise<ILanguageRuntimeSession | undefined> => {

	// If there's an active language runtime, use that.
	// NOTE @samclark2015: Does this even do anything with Multisession???
	// e.g. when would we have sessions running but without an active foreground session?
	const runtimeSessionService = accessor.get(IRuntimeSessionService);
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
	return await selectLanguageRuntimeSession(accessor, { placeholder });
};

/**
 * IInterpreterGroup interface.
 */
interface IInterpreterGroup {
	primaryRuntime: ILanguageRuntimeMetadata;
	alternateRuntimes: ILanguageRuntimeMetadata[];
}

/**
 * Creates an IInterpreterGroup array representing the available language runtimes.
 * @param languageRuntimeService The ILanguageRuntimeService.
 * @returns An IInterpreterGroup array representing the available language runtimes.
 */
const createInterpreterGroups = (
	languageRuntimeService: ILanguageRuntimeService,
	runtimeAffiliationService: IRuntimeStartupService) => {
	const preferredRuntimeByLanguageId = new Map<string, ILanguageRuntimeMetadata>();
	const languageRuntimeGroups = new Map<string, IInterpreterGroup>();
	for (const runtime of languageRuntimeService.registeredRuntimes) {
		const languageId = runtime.languageId;

		// Get the preferred runtime for the language.
		let preferredRuntime = preferredRuntimeByLanguageId.get(languageId);
		if (!preferredRuntime) {
			preferredRuntime = runtimeAffiliationService.getPreferredRuntime(languageId);
			preferredRuntimeByLanguageId.set(languageId, preferredRuntime);
		}

		// Create the language runtime group if it doesn't exist.
		let languageRuntimeGroup = languageRuntimeGroups.get(languageId);
		if (!languageRuntimeGroup) {
			languageRuntimeGroup = { primaryRuntime: preferredRuntime, alternateRuntimes: [] };
			languageRuntimeGroups.set(languageId, languageRuntimeGroup);
		}

		// Add the runtime to the alternateRuntimes array if it's not the preferred runtime.
		if (runtime.runtimeId !== preferredRuntime.runtimeId) {
			languageRuntimeGroup.alternateRuntimes.push(runtime);
		}
	}

	// Sort the runtimes by language name.
	return Array.from(languageRuntimeGroups.values()).sort((a, b) => {
		if (a.primaryRuntime.languageName < b.primaryRuntime.languageName) {
			return -1;
		} else if (a.primaryRuntime.languageName > b.primaryRuntime.languageName) {
			return 1;
		} else {
			return 0;
		}
	});
};

const selectNewLanguageRuntime = async (
	accessor: ServicesAccessor
): Promise<ILanguageRuntimeMetadata | undefined> => {
	// Access services.
	const quickInputService = accessor.get(IQuickInputService);
	const runtimeSessionService = accessor.get(IRuntimeSessionService);
	const runtimeStartupService = accessor.get(IRuntimeStartupService);
	const languageRuntimeService = accessor.get(ILanguageRuntimeService);

	// Group runtimes by language.
	const interpreterGroups = createInterpreterGroups(languageRuntimeService, runtimeStartupService);

	// Grab the current runtime.
	const currentRuntime = runtimeSessionService.foregroundSession?.runtimeMetadata;

	// Grab the active runtimes.
	const activeRuntimes = runtimeSessionService.activeSessions
		// Sort by last used, descending.
		.sort((a, b) => b.lastUsed - a.lastUsed)
		// Map from session to runtime metadata.
		.map(session => session.runtimeMetadata)
		// Remove duplicates, and current runtime.
		.filter((runtime, index, runtimes) =>
			runtime.runtimeId !== currentRuntime?.runtimeId && runtimes.findIndex(r => r.runtimeId === runtime.runtimeId) === index
		);

	// Add current runtime first, if present.
	// Allows for "plus" + enter behavior to clone session.
	if (currentRuntime) {
		activeRuntimes.unshift(currentRuntime);
	}

	// Create a set of active runtime IDs for quick comparison.
	const activeRuntimeIds = new Set(activeRuntimes.map(runtime => runtime.runtimeId));

	// Generate quick pick items for runtimes.
	const runtimeItems: QuickPickItem[] = [];

	if (activeRuntimes.length > 0) {
		// Add a separator for active sessions.
		runtimeItems.push({
			type: 'separator',
			label: localize('positron.languageRuntime.projectRuntimes', 'Project')
		});
		// Add active runtimes first and foremost.
		activeRuntimes.forEach(runtime => {
			runtimeItems.push({
				id: runtime.runtimeId,
				label: runtime.runtimeName,
				detail: runtime.runtimePath,
				iconPath: {
					dark: URI.parse(`data:image/svg+xml;base64, ${runtime.base64EncodedIconSvg}`),
				},
				picked: true
			});
		});
	}


	interpreterGroups.forEach(group => {
		const language = group.primaryRuntime.languageName;
		// Add separator with language name.
		runtimeItems.push({ type: 'separator', label: language });
		// Add primary runtime first.
		if (group.primaryRuntime.runtimeId !== currentRuntime?.runtimeId && !activeRuntimeIds.has(group.primaryRuntime.runtimeId)) {
			runtimeItems.push({
				id: group.primaryRuntime.runtimeId,
				label: group.primaryRuntime.runtimeName,
				detail: group.primaryRuntime.runtimePath,
				iconPath: {
					dark: URI.parse(`data:image/svg+xml;base64, ${group.primaryRuntime.base64EncodedIconSvg}`),
				},
				picked: (group.primaryRuntime.runtimeId === runtimeSessionService.foregroundSession?.runtimeMetadata.runtimeId),
			});
		}
		// Follow with alternate runtimes.
		group.alternateRuntimes.sort((a, b) => a.runtimeName.localeCompare(b.runtimeName));
		group.alternateRuntimes.forEach(runtime => {
			if (runtime.runtimeId !== currentRuntime?.runtimeId && !activeRuntimeIds.has(runtime.runtimeId)) {
				runtimeItems.push({
					id: runtime.runtimeId,
					label: runtime.runtimeName,
					detail: runtime.runtimePath,
					iconPath: {
						dark: URI.parse(`data:image/svg+xml;base64, ${runtime.base64EncodedIconSvg}`),
					},
					picked: (runtime.runtimeId === runtimeSessionService.foregroundSession?.runtimeMetadata.runtimeId),
				});
			}
		});
	});

	// Prompt the user to select a runtime to start
	const selectedRuntime = await quickInputService.pick(
		runtimeItems,
		{
			title: localize('positron.languageRuntime.startSession', 'Start a New Session'),
			canPickMany: false
		}
	);

	// If the user selected a runtime, set it as the active runtime
	if (selectedRuntime?.id) {
		return languageRuntimeService.getRegisteredRuntime(selectedRuntime.id);
	}

	return undefined;
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
			accessor,
			localize('positron.lanuageRuntime.setActive', 'Set the active language runtime'));

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
			session = activeConsole.attachedRuntimeSession;
		}

		// If there's no active console, try the active language runtime.
		if (!session) {
			session = runtimeSessionService.foregroundSession;
		}

		// If we still don't have an active language runtime, ask the user to
		// pick one.
		if (!session) {
			session = await selectRunningLanguageRuntime(
				accessor,
				localize(
					'positron.languageRuntime.selectInterpreterRestart',
					'Select the interpreter to restart'
				)
			);
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
			accessor,
			'Select the interpreter to interrupt'))?.interrupt();
	});

	// Registers the shutdown language runtime action.
	registerLanguageRuntimeAction('workbench.action.languageRuntime.shutdown', 'Shutdown Interpreter', async accessor => {
		(await selectRunningLanguageRuntime(
			accessor,
			'Select the interpreter to shutdown'))?.shutdown();
	});

	// Registers the force quit language runtime action.
	registerLanguageRuntimeAction('workbench.action.languageRuntime.forceQuit', 'Force Quit Interpreter', async accessor => {
		(await selectRunningLanguageRuntime(
			accessor,
			'Select the interpreter to force-quit'))?.forceQuit();
	});

	// Registers the show output language runtime action.
	registerLanguageRuntimeAction('workbench.action.languageRuntime.showOutput', 'Show interpreter output', async accessor => {
		(await selectRunningLanguageRuntime(
			accessor,
			'Select the interpreter for which to show output'))?.showOutput();
	});

	registerLanguageRuntimeAction('workbench.action.languageRuntime.showProfile', 'Show interpreter profile report', async accessor => {
		(await selectRunningLanguageRuntime(
			accessor,
			'Select the interpreter for which to show profile output'))?.showProfile();
	});

	// Registers the clear affiliated language runtime / clear saved interpreter action.
	registerLanguageRuntimeAction('workbench.action.languageRuntime.clearAffiliation', 'Clear Saved Interpreter', async accessor => {
		const runtimeSessionService = accessor.get(IRuntimeStartupService);
		const quickInputService = accessor.get(IQuickInputService);
		const notificationService = accessor.get(INotificationService);

		// Build the language runtime quick pick items.
		const runtimes = runtimeSessionService.getAffiliatedRuntimes();
		const runtimeQuickPickItems = runtimes.map<LanguageRuntimeQuickPickItem>(runtime => ({
			id: runtime.runtimeId,
			label: `${runtime.languageName}: ${runtime.runtimeName}`,
			description: runtime.runtimePath,
			runtime
		} satisfies LanguageRuntimeQuickPickItem));

		if (runtimeQuickPickItems.length === 0) {
			notificationService.info(nls.localize('noInterpretersSaved', 'No interpreters are currently saved in this workspace.'));
			return;
		}

		// Prompt the user to select a language runtime.
		const quickPickItem = await quickInputService
			.pick<LanguageRuntimeQuickPickItem>(runtimeQuickPickItems, {
				canPickMany: false,
				placeHolder: nls.localize('selectInterpreterToClear', 'Select interpreter to clear')
			});

		// User didn't select a runtime.
		if (!quickPickItem) {
			return;
		}

		// Clear the selected interpreter.
		runtimeSessionService.clearAffiliatedRuntime(quickPickItem.runtime.languageId);
		notificationService.info(nls.localize('interpreterCleared', 'The {0} interpreter has been cleared from this workspace.', quickPickItem.runtime.runtimeName));
	});

	registerLanguageRuntimeAction('workbench.action.language.runtime.openClient', 'Create Runtime Client Widget', async accessor => {
		// Access services.
		const quickInputService = accessor.get(IQuickInputService);

		// Ask the user to select a running language runtime.
		const languageRuntime = await selectRunningLanguageRuntime(
			accessor,
			localize('positron.languageRuntime.selectRuntime', 'Select the language runtime')
		);
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
		// const runtimeSessionService = accessor.get(IRuntimeSessionService);
		const quickInputService = accessor.get(IQuickInputService);

		// Ask the user to select a running language runtime.
		const languageRuntime = await selectRunningLanguageRuntime(accessor, 'Select the language runtime');
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


	registerLanguageRuntimeAction(LANGUAGE_RUNTIME_OPEN_ACTIVE_SESSIONS_ID, 'Open Active Session Picker', async accessor => {
		// Access services.
		const runtimeSessionService = accessor.get(IRuntimeSessionService);

		// Prompt the user to select a runtime to use.
		const newActiveSession = await selectLanguageRuntimeSession(accessor, { allowStartSession: true });

		// If the user selected a specific session, set it as the active session if it still exists
		if (newActiveSession) {
			runtimeSessionService.foregroundSession = newActiveSession;
		}
	});

	registerAction2(class extends Action2 {
		/**
		 * Constructor.
		 */
		constructor() {
			super({
				icon: Codicon.plus,
				id: LANGUAGE_RUNTIME_START_SESSION_ID,
				title: {
					value: localize('workbench.action.language.runtime.openStartPicker', "Start a New Session"),
					original: 'Start a New Session'
				},
				category,
				keybinding: {
					primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Slash,
					mac: { primary: KeyMod.WinCtrl | KeyMod.Shift | KeyCode.Slash },
					weight: KeybindingWeight.WorkbenchContrib
				},
				menu: [{
					group: 'navigation',
					id: MenuId.ViewTitle,
					order: 1,
					when: ContextKeyExpr.and(
						ContextKeyExpr.equals('view', POSITRON_CONSOLE_VIEW_ID),
						ContextKeyExpr.equals(`config.${USE_POSITRON_MULTIPLE_CONSOLE_SESSIONS_CONFIG_KEY}`, true),
					),
				}],
			});
		}

		async run(accessor: ServicesAccessor) {
			// Access services.
			const runtimeSessionService = accessor.get(IRuntimeSessionService);

			// Prompt the user to select a runtime to start
			const selectedRuntime = await selectNewLanguageRuntime(accessor);

			// If the user selected a runtime, set it as the active runtime
			if (selectedRuntime?.runtimeId) {
				return await runtimeSessionService.startNewRuntimeSession(
					selectedRuntime.runtimeId,
					selectedRuntime.runtimeName,
					LanguageRuntimeSessionMode.Console,
					undefined,
					'User selected runtime',
					RuntimeStartMode.Starting,
					true
				);
			}
			return undefined;
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
			let fromPrompt = false;

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
				fromPrompt = true;
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
			const attribution: IConsoleCodeAttribution = fromPrompt ?
				{
					// If the user typed in the code, consider it to have been
					// executed interactively.
					source: CodeAttributionSource.Interactive,
					metadata: {
						commandId: 'workbench.action.executeCode.console',
					}
				} :
				{
					// Otherwise, this was probably executed by an extension.
					source: CodeAttributionSource.Extension,
				}

			consoleService.executeCode(
				args.langId, args.code, attribution, !!args.focus, true /* execute the code even if incomplete */);
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

registerAction2(class SetWorkingDirectoryCommand extends Action2 {
	// from explorer
	constructor() {
		super({
			id: 'workbench.action.setWorkingDirectory',
			title: nls.localize2('setWorkingDirectory', "Set as Working Directory in Active Console"),
			category,
			f1: true,
			menu: [
				{
					id: MenuId.ExplorerContext,
					group: '2_workspace',
					order: 10,
					when: ContextKeyExpr.and(ExplorerFolderContext)
				}
			]
		});
	}

	/**
	 * Invoke the command
	 *
	 * @param accessor The services accessor
	 * @param resource The resource to set as the working directory, from the explorer. If not provided, the user will be prompted to select a folder.
	 * @returns
	 */
	async run(accessor: ServicesAccessor, resource?: URI) {
		const sessionService = accessor.get(IRuntimeSessionService);
		const notificationService = accessor.get(INotificationService);
		const session = sessionService.foregroundSession;
		// If there's no active session, do nothing.
		if (!session) {
			notificationService.info(
				nls.localize('positron.setWorkingDirectory.noSession',
					"No active interpreter session; open the Console and select an interpreter before setting the working directory."));
			return;
		}
		// If no resource was provided, ask the user to select a folder.
		if (!resource) {
			const fileDialogService = accessor.get(IFileDialogService);
			const selection = await fileDialogService.showOpenDialog({
				canSelectFolders: true,
				canSelectFiles: false,
				canSelectMany: false,
				openLabel: nls.localize('positron.setWorkingDirectory.setDirectory',
					'Set Directory')
			});
			if (!selection) {
				// No folder was selected.
				return;
			}

			// Use the first selected folder (there should only ever be one selected since we specified `canSelectMany: false`).
			resource = selection[0];
		}

		// At this point we should have a resource.
		if (!resource) {
			return;
		}

		// Attempt to set the working directory to the selected folder.
		try {
			session.setWorkingDirectory(resource.fsPath);
		} catch (e) {
			notificationService.error(e);
		}
	}
});
