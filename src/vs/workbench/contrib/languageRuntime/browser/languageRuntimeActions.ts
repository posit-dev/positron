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
import { IQuickInputService, IQuickPickItem, QuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import { IKeybindingRule, KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { LANGUAGE_RUNTIME_ACTION_CATEGORY } from '../common/languageRuntime.js';
import { IPositronConsoleService, POSITRON_CONSOLE_VIEW_ID } from '../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { ILanguageRuntimeMetadata, ILanguageRuntimeService, LanguageRuntimeSessionMode, RuntimeCodeExecutionMode, RuntimeErrorBehavior, RuntimeState } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession, IRuntimeClientInstance, IRuntimeSessionService, RuntimeClientType, RuntimeStartMode } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { IRuntimeStartupService } from '../../../services/runtimeStartup/common/runtimeStartupService.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { dispose } from '../../../../base/common/lifecycle.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { ExplorerFolderContext } from '../../files/common/files.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { localize } from '../../../../nls.js';
import { CodeAttributionSource, IConsoleCodeAttribution } from '../../../services/positronConsole/common/positronConsoleCodeExecution.js';
import { PositronConsoleInstancesExistContext, PositronConsoleTabFocused } from '../../../common/contextkeys.js';
import { IWorkbenchEnvironmentService } from '../../../services/environment/common/environmentService.js';

// The category for language runtime actions.
const category: ILocalizedString = { value: LANGUAGE_RUNTIME_ACTION_CATEGORY, original: 'Interpreter' };

// Quick pick item interfaces.
interface LanguageRuntimeQuickPickItem extends IQuickPickItem { runtime: ILanguageRuntimeMetadata }
interface RuntimeClientTypeQuickPickItem extends IQuickPickItem { runtimeClientType: RuntimeClientType }
interface RuntimeClientInstanceQuickPickItem extends IQuickPickItem { runtimeClientInstance: IRuntimeClientInstance<any, any> }

// Action IDs
export const LANGUAGE_RUNTIME_SELECT_SESSION_ID = 'workbench.action.language.runtime.selectSession';
export const LANGUAGE_RUNTIME_START_NEW_SESSION_ID = 'workbench.action.language.runtime.startNewSession';
export const LANGUAGE_RUNTIME_RESTART_ACTIVE_SESSION_ID = 'workbench.action.language.runtime.restartActiveSession';
export const LANGUAGE_RUNTIME_RENAME_SESSION_ID = 'workbench.action.language.runtime.renameSession';
export const LANGUAGE_RUNTIME_RENAME_ACTIVE_SESSION_ID = 'workbench.action.language.runtime.renameActiveSession';
export const LANGUAGE_RUNTIME_DUPLICATE_ACTIVE_SESSION_ID = 'workbench.action.language.runtime.duplicateActiveSession';
export const LANGUAGE_RUNTIME_SELECT_RUNTIME_ID = 'workbench.action.languageRuntime.selectRuntime';
export const LANGUAGE_RUNTIME_DISCOVER_RUNTIMES_ID = 'workbench.action.language.runtime.discoverAllRuntimes';

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
 * an array of existing language runtime sessions.
 *
 * @param accessor The service accessor.
 * @param options The options for the quick pick.
 * @param options.allowStartSession Whether to allow the user to start a new session.
 * @param options.title The title of the quick pick.
 * @returns The runtime session the user selected, or undefined, if the user canceled the operation.
 */
const selectLanguageRuntimeSession = async (
	accessor: ServicesAccessor,
	options?: {
		allowStartSession?: boolean;
		title?: string;
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
				label: session.dynState.sessionName,
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
			label: localize('positron.languageRuntime.activeSessions', 'Active Interpreter Sessions'),
			type: 'separator',
		},
		...activeRuntimeItems,
		{
			type: 'separator'
		}
	];

	if (options?.allowStartSession) {
		quickPickItems.push({
			label: localize('positron.languageRuntime.newSession', 'New Interpreter Session...'),
			id: startNewRuntimeId,
			alwaysShow: true
		});
	}
	const result = await quickInputService.pick(quickPickItems, {
		title: options?.title || localize('positron.languageRuntime.selectSession', 'Select Interpreter Session'),
		canPickMany: false,
		activeItem: activeRuntimeItems.filter(item => item.picked)[0]
	});

	// Handle the user's selection.
	if (result?.id === startNewRuntimeId) {
		// If the user selected "All Runtimes...", execute the command to show all runtimes.
		const sessionId: string | undefined = await commandService.executeCommand(LANGUAGE_RUNTIME_START_NEW_SESSION_ID);
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
	runtimeAffiliationService: IRuntimeStartupService
) => {
	const preferredRuntimeByLanguageId = new Map<string, ILanguageRuntimeMetadata>();
	const languageRuntimeGroups = new Map<string, IInterpreterGroup>();
	for (const runtime of languageRuntimeService.registeredRuntimes) {
		const languageId = runtime.languageId;

		// Get the preferred runtime for the language.
		let preferredRuntime = preferredRuntimeByLanguageId.get(languageId);
		if (!preferredRuntime) {
			preferredRuntime = runtimeAffiliationService.getPreferredRuntime(languageId);
			if (preferredRuntime) {
				preferredRuntimeByLanguageId.set(languageId, preferredRuntime);
			}
		}

		// If we didn't find a preferred runtime, skip this one.
		if (!preferredRuntime) {
			continue;
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

/**
 * Helper function that asks the user to select a language runtime from
 * the list of registered language runtimes.
 *
 * This can be used to start a session for a registered language runtime.
 *
 * @param accessor The service accessor.
 * @returns
 */
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

	// Generate quick pick items for runtimes.
	const runtimeItems: QuickPickItem[] = [];

	// Add separator for suggested runtimes
	const suggestedRuntimes = interpreterGroups
		.map(group => group.primaryRuntime);

	if (suggestedRuntimes.length > 0) {
		runtimeItems.push({
			type: 'separator',
			label: localize('positron.languageRuntime.suggestedRuntimes', 'Suggested')
		});

		suggestedRuntimes.forEach(runtime => {
			runtimeItems.push({
				id: runtime.runtimeId,
				label: runtime.runtimeName,
				detail: runtime.runtimePath,
				iconPath: {
					dark: URI.parse(`data:image/svg+xml;base64, ${runtime.base64EncodedIconSvg}`),
				},
				neverShowWhenFiltered: true
			});
		});
	}


	interpreterGroups.forEach(group => {
		// Group runtimes by environment type
		const runtimesByEnvType = new Map<string, ILanguageRuntimeMetadata[]>();
		const allRuntimes = [group.primaryRuntime, ...group.alternateRuntimes];

		allRuntimes.forEach(runtime => {
			const envType = `${runtime.runtimeSource}`;
			if (!runtimesByEnvType.has(envType)) {
				runtimesByEnvType.set(envType, []);
			}
			runtimesByEnvType.get(envType)!.push(runtime);

		});

		const envTypes = Array.from(runtimesByEnvType.keys());

		// Sort runtimes by version (decreasing), then alphabetically
		envTypes.forEach(envType => {
			runtimeItems.push({ type: 'separator', label: envType });
			runtimesByEnvType.get(envType)!
				.sort((a, b) => {
					// If both have version numbers, compare them
					if (a.languageVersion && b.languageVersion) {
						const aVersion = a.languageVersion.split('.').map(Number);
						const bVersion = b.languageVersion.split('.').map(Number);

						// Always list unsupported versions last
						if (!a.extraRuntimeData.supported) {
							return 1;
						}
						if (!b.extraRuntimeData.supported) {
							return -1;
						}
						// Compare major version
						if (aVersion[0] !== bVersion[0]) {
							return bVersion[0] - aVersion[0];
						}

						// Compare minor version
						if (aVersion[1] !== bVersion[1]) {
							return bVersion[1] - aVersion[1];
						}

						// Compare patch version
						if (aVersion[2] !== bVersion[2]) {
							return bVersion[2] - aVersion[2];
						}
					}

					// If versions are equal or not found, sort alphabetically
					return a.runtimeName.localeCompare(b.runtimeName);
				})
				.forEach(runtime => {
					runtimeItems.push({
						id: runtime.runtimeId,
						label: runtime.runtimeName,
						detail: runtime.runtimePath,
						iconPath: {
							dark: URI.parse(`data:image/svg+xml;base64, ${runtime.base64EncodedIconSvg}`),
						},
						picked: (runtime.runtimeId === runtimeSessionService.foregroundSession?.runtimeMetadata.runtimeId),
						neverShowWhenFiltered: false
					});
				});

		});
	});

	// Prompt the user to select a runtime to start
	const selectedRuntime = await quickInputService.pick(
		runtimeItems,
		{
			title: localize('positron.languageRuntime.startSession', 'Start New Interpreter Session'),
			canPickMany: false
		}
	);

	// If the user selected a runtime, return the runtime metadata.
	if (selectedRuntime?.id) {
		return languageRuntimeService.getRegisteredRuntime(selectedRuntime.id);
	}

	return undefined;
};

/**
 * Helper function to rename a session.
 *
 * @param accessor The service accessor.
 * @param sessionId The ID of the session to rename.
 */
const renameLanguageRuntimeSession = async (
	sessionService: IRuntimeSessionService,
	notificationService: INotificationService,
	quickInputService: IQuickInputService,
	sessionId: string
) => {
	// Prompt the user to enter the new session name.
	const sessionName = await quickInputService.input({
		value: '',
		placeHolder: '',
		prompt: nls.localize('positron.console.renameSession.prompt', "Enter the new session name"),
	});

	// Validate the new session name
	const newSessionName = sessionName?.trim();
	if (!newSessionName?.trim()) {
		return;
	}

	// Attempt to rename the session.
	try {
		sessionService.updateSessionName(sessionId, newSessionName);
	} catch (error) {
		notificationService.error(
			localize('positron.console.renameSession.error',
				"Failed to rename session {0}: {1}",
				sessionId,
				error
			)
		);
	}
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

	/**
	 * Action used to select a registered language runtime (aka interpreter).
	 *
	 * NOTE: This is a convenience action that is used by the notebook services
	 */
	registerAction2(class PickInterpreterAction extends Action2 {
		constructor() {
			super({
				id: LANGUAGE_RUNTIME_SELECT_RUNTIME_ID,
				title: nls.localize2('positron.command.selectInterpreter', "Select Interpreter"),
				f1: false,
				category,
			});
		}

		async run(accessor: ServicesAccessor) {
			const languageRuntime = await selectNewLanguageRuntime(accessor);
			return languageRuntime?.runtimeId;
		}
	});

	/**
	 * Action that allows the user to remove a runtime from the list of offiliated runtimes.
	 */
	registerLanguageRuntimeAction('workbench.action.languageRuntime.clearAffiliatedRuntime', 'Clear Saved Interpreter', async accessor => {
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

	/**
	 * Action that allows the user to change the foreground session.
	 */
	registerLanguageRuntimeAction(LANGUAGE_RUNTIME_SELECT_SESSION_ID, 'Select Interpreter Session', async accessor => {
		// Access services.
		const commandService = accessor.get(ICommandService);
		const runtimeSessionService = accessor.get(IRuntimeSessionService);

		// Prompt the user to select a runtime to use.
		const newActiveSession = await selectLanguageRuntimeSession(accessor, { allowStartSession: true });

		// If the user selected a specific session, set it as the active session if it still exists
		if (newActiveSession) {
			// Drive focus into the Positron console.
			commandService.executeCommand('workbench.panel.positronConsole.focus');
			runtimeSessionService.foregroundSession = newActiveSession;
		}
	});

	/**
	 * Action that allows the user to create a new session from a list of registered runtimes.
	 */
	registerAction2(class extends Action2 {
		/**
		 * Constructor.
		 */
		constructor() {
			super({
				icon: Codicon.plus,
				id: LANGUAGE_RUNTIME_START_NEW_SESSION_ID,
				title: {
					value: localize('positron.languageRuntime.startSession', 'Start New Interpreter Session'),
					original: 'Start New Interpreter Session'
				},
				category,
				f1: true,
				menu: [{
					group: 'navigation',
					id: MenuId.ViewTitle,
					order: 1,
					when: ContextKeyExpr.and(
						ContextKeyExpr.equals('view', POSITRON_CONSOLE_VIEW_ID),
						PositronConsoleInstancesExistContext.negate()
					),
				}],
				keybinding: {
					primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Slash,
					mac: { primary: KeyMod.WinCtrl | KeyMod.Shift | KeyCode.Slash },
					weight: KeybindingWeight.WorkbenchContrib
				}
			});
		}

		async run(accessor: ServicesAccessor) {
			// Access services.
			const commandService = accessor.get(ICommandService);
			const runtimeSessionService = accessor.get(IRuntimeSessionService);

			// Prompt the user to select a runtime to start
			const selectedRuntime = await selectNewLanguageRuntime(accessor);

			// If the user selected a runtime, set it as the active runtime
			if (selectedRuntime?.runtimeId) {
				// Drive focus into the Positron console.
				commandService.executeCommand('workbench.panel.positronConsole.focus');

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
	 * Action that allows the user to create a new session based off the current active session.
	 * This utilizes the runtime data from the current session to create a new session.
	 */
	registerAction2(class extends Action2 {
		constructor() {
			super({
				icon: Codicon.plus,
				id: LANGUAGE_RUNTIME_DUPLICATE_ACTIVE_SESSION_ID,
				title: {
					value: localize('positron.languageRuntime.duplicateSession.title', 'Duplicate Active Interpreter Session'),
					original: 'Duplicate Session'
				},
				category,
				f1: true,
				menu: [{
					group: 'navigation',
					id: MenuId.ViewTitle,
					order: 1,
					when: ContextKeyExpr.and(
						ContextKeyExpr.equals('view', POSITRON_CONSOLE_VIEW_ID),
						PositronConsoleInstancesExistContext
					),
				}],
			});
		}

		async run(accessor: ServicesAccessor) {
			// Access services
			const commandService = accessor.get(ICommandService);
			const runtimeSessionService = accessor.get(IRuntimeSessionService);
			const notificationService = accessor.get(INotificationService);

			// Get the current foreground session.
			const currentSession = runtimeSessionService.foregroundSession;
			if (!currentSession) {
				return;
			}

			if (currentSession.metadata.sessionMode !== LanguageRuntimeSessionMode.Console) {
				notificationService.error(localize('positron.languageRuntime.duplicate.notConsole', 'Cannot duplicate session. The current session is not a console session.'));
				return;
			}

			// Drive focus into the Positron console.
			commandService.executeCommand('workbench.panel.positronConsole.focus');

			// Duplicate the current session with the `startNewRuntimeSession` method.
			await runtimeSessionService.startNewRuntimeSession(
				currentSession.runtimeMetadata.runtimeId,
				currentSession.dynState.sessionName,
				currentSession.metadata.sessionMode,
				undefined,
				`Duplicated session: ${currentSession.dynState.sessionName}`,
				RuntimeStartMode.Starting,
				true
			);
		}
	});

	/**
	 * Action that allows the user to rename an active session.
	 */
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: LANGUAGE_RUNTIME_RENAME_SESSION_ID,
				title: nls.localize2('positron.console.renameSesison', "Rename Interpreter Session"),
				category,
				f1: true,
			});
		}

		/**
		 * Renames a session
		 *
		 * @param accessor The service accessor
		 * @returns A promise that resolves when the session has been renamed
		 */
		async run(accessor: ServicesAccessor) {
			const sessionService = accessor.get(IRuntimeSessionService);
			const notificationService = accessor.get(INotificationService);
			const quickInputService = accessor.get(IQuickInputService);

			// Prompt the user to select a session they want to rename.
			const session = await selectLanguageRuntimeSession(
				accessor, { title: 'Select Interpreter Session To Rename' });
			if (!session) {
				return;
			}

			await renameLanguageRuntimeSession(
				sessionService,
				notificationService,
				quickInputService,
				session.sessionId
			);
		}
	});

	/**
	 * Action that allows the user to rename the foreground session.
	 *
	 * Note: This is a convenience action that is used to allow the user to rename
	 * the currently active session without having to select it via the UI.
	 */
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: LANGUAGE_RUNTIME_RENAME_ACTIVE_SESSION_ID,
				title: nls.localize2('positron.console.renameActiveSesison', "Rename Active Interpreter Session"),
				category,
				f1: true,
				keybinding: {
					primary: KeyCode.Enter,
					when: PositronConsoleTabFocused,
					weight: KeybindingWeight.WorkbenchContrib
				}
			});
		}

		/**
		 * Renames the currently active session
		 *
		 * @param accessor The service accessor
		 * @returns A promise that resolves when the session has been renamed
		 */
		async run(accessor: ServicesAccessor) {
			const sessionService = accessor.get(IRuntimeSessionService);
			const notificationService = accessor.get(INotificationService);
			const quickInputService = accessor.get(IQuickInputService);

			// Get the active session
			const session = sessionService.foregroundSession;
			if (!session) {
				return;
			}

			await renameLanguageRuntimeSession(
				sessionService,
				notificationService,
				quickInputService,
				session.sessionId
			);
		}
	});

	/**
	 * Action that allows the user to restart an active session.
	 */
	registerLanguageRuntimeAction(
		LANGUAGE_RUNTIME_RESTART_ACTIVE_SESSION_ID,
		'Restart Active Interpreter Session',
		async accessor => {
			const sessionService = accessor.get(IRuntimeSessionService);

			// Get the active session
			const session = sessionService.foregroundSession;
			if (!session) {
				return;
			}

			// Restart the session
			sessionService.restartSession(session.sessionId,
				`'Restart Active Interpreter Session' command invoked`);

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

	/**
	 * Action that allows the user to interrupt the active session.
	 */
	registerLanguageRuntimeAction('workbench.action.languageRuntime.interrupt', 'Interrupt Active Interpreter Session', async accessor => {
		const sessionService = accessor.get(IRuntimeSessionService);

		// Get the active session
		const session = sessionService.foregroundSession;
		if (!session) {
			return;
		}

		session.interrupt();
	});

	/**
	 * Action that allows the user to force-quit the active session.
	 */
	registerLanguageRuntimeAction('workbench.action.languageRuntime.forceQuit', 'Force Quit Active Interpreter Session', async accessor => {
		const sessionService = accessor.get(IRuntimeSessionService);

		// Get the active session
		const session = sessionService.foregroundSession;
		if (!session) {
			return;
		}

		session.forceQuit();
	});

	/**
	 * Action that allows the user to show the output channel for the active session.
	 */
	registerLanguageRuntimeAction('workbench.action.languageRuntime.showOutput', 'Show Active Interpreter Session Output', async accessor => {
		const sessionService = accessor.get(IRuntimeSessionService);

		// Get the active session
		const session = sessionService.foregroundSession;
		if (!session) {
			return;
		}

		session.showOutput();
	});

	/**
	 * Action that allows the user to show the profile report for an active session.
	 */
	registerLanguageRuntimeAction('workbench.action.languageRuntime.showProfile', 'Show Active Interpreter Session Profile Report', async accessor => {
		const sessionService = accessor.get(IRuntimeSessionService);

		// Get the active session
		const session = sessionService.foregroundSession;
		if (!session) {
			return;
		}

		session.showProfile();
	});

	registerAction2(class ExecuteCodeInConsoleAction extends Action2 {

		constructor() {
			super({
				id: 'workbench.action.language.runtime.openClient',
				title: nls.localize2('positron.command.openClient', "Create Runtime Client Widget"),
				f1: false,
				category
			});
		}

		async run(accessor: ServicesAccessor) {
			// Access services.
			const quickInputService = accessor.get(IQuickInputService);

			// Prompt the user to select a session
			const session = await selectLanguageRuntimeSession(accessor);
			if (!session) {
				return;
			}

			// Prompt the user to select the runtime client type.
			const selection = await quickInputService.pick<RuntimeClientTypeQuickPickItem>(
				[
					{
						id: generateUuid(),
						label: 'Environment Pane',
						runtimeClientType: RuntimeClientType.Variables,
					}
				],
				{
					canPickMany: false,
					placeHolder: `Select runtime client for ${session.runtimeMetadata.runtimeName}`
				}
			);

			// If the user selected a runtime client type, create the client for it.
			if (selection) {
				session.createClient(selection.runtimeClientType, null);
			}
		}
	});

	registerAction2(class ExecuteCodeInConsoleAction extends Action2 {

		constructor() {
			super({
				id: 'workbench.action.language.runtime.closeClient',
				title: nls.localize2('positron.command.closeClient', "Close Runtime Client Widget"),
				f1: false,
				category
			});
		}

		async run(accessor: ServicesAccessor) {
			const quickInputService = accessor.get(IQuickInputService);

			// Prompt the user to select a session
			const session = await selectLanguageRuntimeSession(accessor);
			if (!session) {
				return;
			}

			// Get the runtime client instances for the session.
			const runtimeClientInstances = await session.listClients();
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
				placeHolder: nls.localize('Client Close Selection Placeholder', 'Close Client for {0}', session.runtimeMetadata.runtimeName)
			});

			// If the user selected a runtime client instance, dispose it.
			if (selection) {
				selection.runtimeClientInstance.dispose();
			}
		}
	});

	registerAction2(class extends Action2 {
		/**
		 * Constructor.
		 */
		constructor() {
			super({
				id: LANGUAGE_RUNTIME_DISCOVER_RUNTIMES_ID,
				title: nls.localize2('workbench.action.language.runtime.discoverAllRuntimes', "Discover All Interpreters"),
				f1: true,
				category
			});
		}

		async run(accessor: ServicesAccessor) {
			// Access service.
			const runtimeStartupService = accessor.get(IRuntimeStartupService);

			// Kick off discovery.
			runtimeStartupService.rediscoverAllRuntimes();
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

			// TODO: Should this be a "Developer: " command?
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
				};

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
	 *
	 * Commonly used by users by creating a keyboard shortcut for this action.
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
		const environmentService = accessor.get(IWorkbenchEnvironmentService);
		const session = sessionService.foregroundSession;
		// If there's no active session, do nothing.
		if (!session) {
			notificationService.info(
				nls.localize('positron.setWorkingDirectory.noSession',
					"No active interpreter session; open the Console and select an interpreter session before setting the working directory."));
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
			if (environmentService.remoteAuthority) {
				// When connected to a remote environment, use the path directly.
				session.setWorkingDirectory(resource.path);
			} else {
				// When not connected to a remote environment, use the local
				// filesystem path if it exists.
				session.setWorkingDirectory(resource.fsPath ?? resource.path);
			}
		} catch (e) {
			notificationService.error(e);
		}
	}
});
