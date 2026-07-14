/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2, ILocalizedString } from '../../../../nls.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IQuickInputService, IQuickPickItem, QuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import { IKeybindingRule, KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { LANGUAGE_RUNTIME_ACTION_CATEGORY } from '../common/languageRuntime.js';
import { IPositronConsoleService, POSITRON_CONSOLE_VIEW_ID } from '../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { ILanguageRuntimeMetadata, ILanguageRuntimeService, IRuntimePickerContribution, IRuntimePickerItem, LanguageRuntimeSessionMode, RuntimeCodeExecutionMode, RuntimeErrorBehavior, RuntimeStartupPhase, RuntimeState } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession, IRuntimeClientInstance, IRuntimeSessionService, RuntimeClientType, RuntimeStartMode } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { getSessionDisplayName, getSessionIconClasses, isQuartoSession } from '../../positronConsole/common/sessionDisplayUtils.js';
import { POSITRON_NOTEBOOK_EDITOR_INPUT_ID, SELECT_KERNEL_ID_POSITRON } from '../../positronNotebook/common/positronNotebookCommon.js';
import { IRuntimeStartupService } from '../../../services/runtimeStartup/common/runtimeStartupService.js';
import { IRuntimeDiscoveryCache } from '../../../services/runtimeStartup/common/runtimeDiscoveryCacheService.js';
import { CommandsRegistry, ICommandService } from '../../../../platform/commands/common/commands.js';
import { DisposableStore, dispose } from '../../../../base/common/lifecycle.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { ExplorerFolderContext } from '../../files/common/files.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { CodeAttributionSource, IConsoleCodeAttribution } from '../../../services/positronConsole/common/positronConsoleCodeExecution.js';
import { PositronConsoleInstancesExistContext, PositronConsoleTabFocused } from '../../../common/contextkeys.js';
import { IWorkbenchEnvironmentService } from '../../../services/environment/common/environmentService.js';
import { IProgressService, ProgressLocation } from '../../../../platform/progress/common/progress.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { getErrorMessage } from '../../../../base/common/errors.js';

// The category for language runtime actions.
const category: ILocalizedString = { value: LANGUAGE_RUNTIME_ACTION_CATEGORY, original: 'Interpreter' };

/**
 * Builds a display label that includes the runtime name for notebook sessions
 * since the session name for notebooks has no information about the runtime
 * being used.
 */
function getSessionDisplayNameWithRuntime(session: ILanguageRuntimeSession): string {
	const notebookUri = session.metadata.notebookUri;
	const base = getSessionDisplayName({ notebookUri, sessionName: session.dynState.sessionName });
	// just to be safe, if this is not a notebook session or we don't have a notebook URI, return the base display name.
	if (session.metadata.sessionMode !== LanguageRuntimeSessionMode.Notebook || !notebookUri) {
		return base;
	}
	// For Quarto sessions, sessionName already equals the filename, so using
	// it as the " - env" suffix would duplicate. Fall back to runtimeName.
	const env = session.dynState.sessionName === base
		? session.runtimeMetadata.runtimeName
		: session.dynState.sessionName;
	return `${base} - ${env}`;
}

// Quick pick item interfaces.
interface LanguageRuntimeQuickPickItem extends IQuickPickItem { runtime: ILanguageRuntimeMetadata }
interface RuntimeClientTypeQuickPickItem extends IQuickPickItem { runtimeClientType: RuntimeClientType }
interface RuntimeClientInstanceQuickPickItem extends IQuickPickItem { runtimeClientInstance: IRuntimeClientInstance<unknown, unknown> }

// Action IDs
export const LANGUAGE_RUNTIME_SELECT_SESSION_ID = 'workbench.action.language.runtime.selectSession';
export const LANGUAGE_RUNTIME_RESTART_ACTIVE_SESSION_ID = 'workbench.action.language.runtime.restartActiveSession';
export const LANGUAGE_RUNTIME_RENAME_SESSION_ID = 'workbench.action.language.runtime.renameSession';
export const LANGUAGE_RUNTIME_RENAME_ACTIVE_SESSION_ID = 'workbench.action.language.runtime.renameActiveSession';
export const LANGUAGE_RUNTIME_DISCOVER_RUNTIMES_ID = 'workbench.action.language.runtime.discoverAllRuntimes';
export const LANGUAGE_RUNTIME_CLEAR_INTERPRETER_CACHE_ID = 'workbench.action.language.runtime.clearInterpreterCache';

// Console Session Specific Action IDs
export const LANGUAGE_RUNTIME_START_NEW_CONSOLE_SESSION_ID = 'workbench.action.language.runtime.startNewConsoleSession';
export const LANGUAGE_RUNTIME_DUPLICATE_ACTIVE_CONSOLE_SESSION_ID = 'workbench.action.language.runtime.duplicateActiveConsoleSession';

// Notebook Session Specific Action IDs
export const LANGUAGE_RUNTIME_SELECT_LEGACY_NOTEBOOK_RUNTIME_ID = 'workbench.action.languageRuntime.selectLegacyNotebookRuntime';

// Prefix for contributed picker items
const CONTRIBUTED_ITEM_PREFIX = '__contributed__';

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
		input.placeholder = localize('positron.executeCode.selectLanguage', 'Select the language to execute code in');

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
 * @param options.includeNotebookSessions Whether to display notebook and quarto
 *   sessions (disabled) alongside console sessions. Defaults to true; set to
 *   false for actions that only operate on console sessions.
 * @returns The runtime session the user selected, or undefined, if the user canceled the operation.
 */
export const selectLanguageRuntimeSession = async (
	accessor: ServicesAccessor,
	options?: {
		allowStartSession?: boolean;
		title?: string;
		includeNotebookSessions?: boolean;
	}): Promise<ILanguageRuntimeSession | undefined> => {

	// Constants
	const startNewRuntimeId = generateUuid();
	const changeNotebookSessionId = generateUuid();

	// Access services.
	const quickInputService = accessor.get(IQuickInputService);
	const runtimeSessionService = accessor.get(IRuntimeSessionService);
	const commandService = accessor.get(ICommandService);
	const editorService = accessor.get(IEditorService);
	const modelService = accessor.get(IModelService);
	const languageService = accessor.get(ILanguageService);

	const includeNotebookSessions = options?.includeNotebookSessions ?? true;

	const iconClassesForSession = (session: ILanguageRuntimeSession): string[] =>
		getSessionIconClasses(
			{
				sessionMode: session.metadata.sessionMode,
				notebookUri: session.metadata.notebookUri,
				languageId: session.runtimeMetadata.languageId,
			},
			modelService,
			languageService,
		);

	// Filter active sessions by runtime state (exclude exited/uninitialized sessions).
	const isActiveState = (session: ILanguageRuntimeSession) => {
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
	};

	const currentForegroundSession = runtimeSessionService.foregroundSession;
	const sessionItems: IQuickPickItem[] = [];

	// Create quick pick items for active console sessions sorted by creation time, oldest to newest.
	const consoleItems: IQuickPickItem[] = runtimeSessionService.activeSessions
		.filter(session => session.metadata.sessionMode === LanguageRuntimeSessionMode.Console)
		.filter(isActiveState)
		.sort((a, b) => a.metadata.createdTimestamp - b.metadata.createdTimestamp)
		.map(session => ({
			id: session.sessionId,
			label: session.dynState.sessionName,
			detail: session.runtimeMetadata.runtimePath,
			description: session.sessionId === currentForegroundSession?.sessionId
				? localize('positron.languageRuntime.currentlySelected', 'Currently Selected')
				: undefined,
			iconClasses: iconClassesForSession(session),
			picked: session.sessionId === currentForegroundSession?.sessionId
		}));

	const quickPickItems: QuickPickItem[] = [
		{
			label: localize('positron.languageRuntime.activeConsoleSessions', 'Console Sessions'),
			type: 'separator',
		},
		...consoleItems,
	];
	sessionItems.push(...consoleItems);

	if (includeNotebookSessions) {
		// Active notebook sessions (includes quarto), sorted by creation time.
		const activeNotebookSessions = runtimeSessionService.activeSessions
			.filter(session => session.metadata.sessionMode === LanguageRuntimeSessionMode.Notebook)
			.filter(isActiveState)
			.sort((a, b) => a.metadata.createdTimestamp - b.metadata.createdTimestamp);

		const notebookItems: IQuickPickItem[] = activeNotebookSessions
			.filter(session => !isQuartoSession({ notebookUri: session.metadata.notebookUri, modelService }))
			.map(session => ({
				id: session.sessionId,
				label: getSessionDisplayNameWithRuntime(session),
				detail: session.runtimeMetadata.runtimePath,
				description: session.sessionId === currentForegroundSession?.sessionId
					? localize('positron.languageRuntime.currentlySelected', 'Currently Selected')
					: undefined,
				iconClasses: iconClassesForSession(session),
				picked: session.sessionId === currentForegroundSession?.sessionId,
			}));

		if (notebookItems.length > 0) {
			quickPickItems.push({
				label: localize('positron.languageRuntime.notebookSessions', 'Notebook Sessions'),
				type: 'separator',
			});
			quickPickItems.push(...notebookItems);
			sessionItems.push(...notebookItems);
		}

		const quartoItems: IQuickPickItem[] = activeNotebookSessions
			.filter(session => isQuartoSession({ notebookUri: session.metadata.notebookUri, modelService }))
			.map(session => ({
				id: session.sessionId,
				label: getSessionDisplayNameWithRuntime(session),
				detail: session.runtimeMetadata.runtimePath,
				description: session.sessionId === currentForegroundSession?.sessionId
					? localize('positron.languageRuntime.currentlySelected', 'Currently Selected')
					: undefined,
				iconClasses: iconClassesForSession(session),
				picked: session.sessionId === currentForegroundSession?.sessionId,
			}));

		if (quartoItems.length > 0) {
			quickPickItems.push({
				label: localize('positron.languageRuntime.quartoSessions', 'Quarto Sessions'),
				type: 'separator',
			});
			quickPickItems.push(...quartoItems);
			sessionItems.push(...quartoItems);
		}
	}

	const showChangeNotebookSession =
		includeNotebookSessions
		&& currentForegroundSession?.metadata.sessionMode === LanguageRuntimeSessionMode.Notebook
		&& currentForegroundSession.metadata.notebookUri !== undefined
		&& editorService.activeEditor?.typeId === POSITRON_NOTEBOOK_EDITOR_INPUT_ID
		&& !isQuartoSession({
			notebookUri: currentForegroundSession.metadata.notebookUri,
			modelService,
		});

	if (showChangeNotebookSession || options?.allowStartSession) {
		quickPickItems.push({ type: 'separator' });
	}
	if (options?.allowStartSession) {
		quickPickItems.push({
			label: localize('positron.languageRuntime.newConsoleSession', 'New Console Session...'),
			id: startNewRuntimeId,
			alwaysShow: true,
		});
	}
	if (showChangeNotebookSession) {
		quickPickItems.push({
			label: localize('positron.languageRuntime.changeNotebookSession', 'Change Notebook Session...'),
			id: changeNotebookSessionId,
			alwaysShow: true,
		});
	}
	const result = await quickInputService.pick(quickPickItems, {
		title: options?.title || localize('positron.languageRuntime.selectSession.quickPickTitle', 'Select Interpreter Session'),
		canPickMany: false,
		activeItem: sessionItems.find(item => item.picked)
	});

	// Handle the user's selection.
	if (result?.id === startNewRuntimeId) {
		// If the user selected "New Console Session...", execute the command to start a new console session.
		const sessionId: string | undefined = await commandService.executeCommand(LANGUAGE_RUNTIME_START_NEW_CONSOLE_SESSION_ID);
		if (sessionId) {
			return runtimeSessionService.activeSessions.find(session => session.sessionId === sessionId);
		}
	} else if (result?.id === changeNotebookSessionId) {
		await commandService.executeCommand(SELECT_KERNEL_ID_POSITRON);
		return undefined;
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
 * @param options Picker options.
 * @param options.title Title shown in the quickpick header.
 * @param options.languageId Restricts the runtimes shown in the picker
 *   to the provided language id. When omitted all languages are shown.
 * @param options.currentRuntimeId Runtime id to focus when the picker
 *   opens initially. Only applied to the initial list so subsequent
 *   rebuilds don't overwrite the user's keyboard navigation.
 * @returns The selected runtime metadata, or undefined if the user
 *   cancelled.
 */
export const selectNewLanguageRuntime = async (
	accessor: ServicesAccessor,
	options?: {
		title?: string;
		languageId?: string;
		currentRuntimeId?: string;
	}): Promise<ILanguageRuntimeMetadata | undefined> => {
	// Access services.
	const quickInputService = accessor.get(IQuickInputService);
	const runtimeStartupService = accessor.get(IRuntimeStartupService);
	const languageRuntimeService = accessor.get(ILanguageRuntimeService);

	// Map to track which contribution owns which item
	const contributedItemMap = new Map<string, { contribution: IRuntimePickerContribution; originalId: string }>();
	let contributionResults: { contribution: IRuntimePickerContribution; items: IRuntimePickerItem[] }[] = [];

	// Get contributed items from extensions (e.g., "Install Python via uv").
	// Only show contributed items after discovery is complete.
	const fetchContributedItems = async () => {
		if (languageRuntimeService.startupPhase !== RuntimeStartupPhase.Complete) {
			contributionResults = [];
			return;
		}
		const contributions = languageRuntimeService.getPickerContributions(options?.languageId);
		// Fetch items from all contributions in parallel
		contributionResults = await Promise.all(
			contributions.map(async (contribution) => {
				try {
					const items = await contribution.getItems();
					return { contribution, items };
				} catch (error) {
					// Log but don't fail if a contribution errors
					console.error(`Failed to get picker items from contribution: ${error}`);
					return { contribution, items: [] };
				}
			})
		);
	};

	const buildItems = (): QuickPickItem[] => {
		// Generate quick pick items for runtimes.
		const items: QuickPickItem[] = [];
		contributedItemMap.clear();

		// Group runtimes by language. Re-evaluated on each rebuild so newly
		// registered runtimes show up. Restricted to options.languageId when set.
		const interpreterGroups = createInterpreterGroups(languageRuntimeService, runtimeStartupService)
			.filter(group => !options?.languageId || group.primaryRuntime.languageId === options.languageId);

		// Add separator for suggested runtimes
		const suggestedRuntimes = interpreterGroups
			.map(group => group.primaryRuntime);

		if (suggestedRuntimes.length > 0) {
			items.push({
				type: 'separator',
				label: localize('positron.languageRuntime.suggestedRuntimes', 'Suggested')
			});

			suggestedRuntimes.forEach(runtime => {
				items.push({
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
				items.push({ type: 'separator', label: envType });
				runtimesByEnvType.get(envType)!
					.sort((a, b) => {
						// If both have version numbers, compare them
						if (a.languageVersion && b.languageVersion) {
							const aVersion = a.languageVersion.split('.').map(Number);
							const bVersion = b.languageVersion.split('.').map(Number);

							// Always list unsupported versions last
							if (!(a.extraRuntimeData as { supported?: boolean })?.supported) {
								return 1;
							}
							if (!(b.extraRuntimeData as { supported?: boolean })?.supported) {
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
						items.push({
							id: runtime.runtimeId,
							label: runtime.runtimeName,
							detail: runtime.runtimePath,
							iconPath: {
								dark: URI.parse(`data:image/svg+xml;base64, ${runtime.base64EncodedIconSvg}`),
							},
							neverShowWhenFiltered: false
						});
					});

			});
		});

		// TODO: right now, these are added to the end of the list, but we may want to
		// group by language in the future
		for (const { contribution, items: contribItems } of contributionResults) {
			for (const item of contribItems) {
				// Create a unique ID for this item that includes the contribution handle
				const uniqueId = `${CONTRIBUTED_ITEM_PREFIX}${contribution.handle}_${item.id}`;
				contributedItemMap.set(uniqueId, { contribution, originalId: item.id });

				if (item.separatorLabel) {
					items.push({ type: 'separator', label: item.separatorLabel });
				}
				items.push({
					id: uniqueId,
					label: item.label,
					detail: item.detail,
				});
			}
		}

		return items;
	};

	const disposables = new DisposableStore();
	const quickPick = disposables.add(quickInputService.createQuickPick<IQuickPickItem>({ useSeparators: true }));
	quickPick.title = options?.title || localize('positron.languageRuntime.startSession', 'Start New Interpreter Session');
	quickPick.canSelectMany = false;

	// Reflect discovery state in the picker: a busy spinner while runtimes are
	// still being discovered, and an explanatory placeholder for an empty list.
	// Phase is read from ILanguageRuntimeService -- the same service the rebuild
	// subscription below uses.
	const updateDiscoveryProgress = () => {
		const discovering = languageRuntimeService.startupPhase !== RuntimeStartupPhase.Complete;
		quickPick.busy = discovering;
		if (discovering) {
			quickPick.placeholder = localize('positron.languageRuntime.discoveringInterpreters', "Discovering interpreters...");
		} else if (!quickPick.items.some(item => item.type !== 'separator')) {
			quickPick.placeholder = localize('positron.languageRuntime.noInterpretersFound', "No interpreters found");
		} else {
			quickPick.placeholder = undefined;
		}
	};

	// Reassigning quickPick.items resets activeItems to the first row, so
	// rebuilds via this helper preserve the previously focused item (whether
	// it was the caller's currentRuntimeId or a row the user keyboard-
	// navigated to). Falls back to the default reset if the previous item
	// is no longer present.
	const rebuildItems = () => {
		const previouslyActiveId = quickPick.activeItems[0]?.id;
		quickPick.items = buildItems();
		if (previouslyActiveId) {
			const stillPresent = quickPick.items.find(
				(item): item is IQuickPickItem => item.type !== 'separator' && item.id === previouslyActiveId
			);
			if (stillPresent) {
				quickPick.activeItems = [stillPresent];
			}
		}
		updateDiscoveryProgress();
	};

	quickPick.items = buildItems();

	// Pre-focus the caller-supplied current runtime, if any. Subsequent
	// rebuilds carry this forward via rebuildItems' restore logic.
	if (options?.currentRuntimeId) {
		const currentItem = quickPick.items.find(
			(item): item is IQuickPickItem => item.type !== 'separator' && item.id === options.currentRuntimeId
		);
		if (currentItem) {
			quickPick.activeItems = [currentItem];
		}
	}

	// Set the initial busy/placeholder state for the phase the picker opened in.
	updateDiscoveryProgress();

	// Rebuild when a new runtime registers - covers late initial discovery
	// and post-startup rediscovery.
	disposables.add(languageRuntimeService.onDidRegisterRuntime(() => {
		rebuildItems();
	}));

	// Rebuild when a runtime is unregistered - covers de-duplication collapsing
	// a symlink alias or a deleted interpreter while the picker is open.
	disposables.add(languageRuntimeService.onDidUnregisterRuntime(() => {
		rebuildItems();
	}));

	// If startup completes while the picker is open, re-fetch contributions
	// (which we previously skipped) and rebuild.
	disposables.add(languageRuntimeService.onDidChangeRuntimeStartupPhase(async phase => {
		if (phase === RuntimeStartupPhase.Complete) {
			// Discovery finished: pick up contributions we skipped, rebuild (which
			// also clears the spinner via updateDiscoveryProgress), and we're done.
			await fetchContributedItems();
			rebuildItems();
		} else {
			// Any other transition (e.g. into Discovering): refresh the spinner /
			// placeholder.
			updateDiscoveryProgress();
		}
	}));

	return new Promise<ILanguageRuntimeMetadata | undefined>(resolve => {
		let accepted: IQuickPickItem | undefined;

		disposables.add(quickPick.onDidAccept(() => {
			const selected = quickPick.activeItems[0];
			if (!selected) {
				return;
			}
			accepted = selected;
			quickPick.hide();
		}));

		disposables.add(quickPick.onDidHide(async () => {
			const selectedRuntime = accepted;
			disposables.dispose();

			if (!selectedRuntime?.id) {
				resolve(undefined);
				return;
			}

			// Handle contributed items
			if (selectedRuntime.id.startsWith(CONTRIBUTED_ITEM_PREFIX)) {
				const contributedItem = contributedItemMap.get(selectedRuntime.id);
				if (!contributedItem) {
					resolve(undefined);
					return;
				}
				try {
					const runtimeId = await contributedItem.contribution.onSelect(contributedItem.originalId);
					if (runtimeId) {
						// Use quiet mode to suppress notifications since the picker
						// contribution already handled registration.
						await runtimeStartupService.rediscoverAllRuntimes(/* quiet */ true);
						resolve(languageRuntimeService.getRegisteredRuntime(runtimeId));
						return;
					}
				} catch (error) {
					console.error(`Failed to handle contributed item selection: ${error}`);
				}
				resolve(undefined);
				return;
			}

			resolve(languageRuntimeService.getRegisteredRuntime(selectedRuntime.id));
		}));

		quickPick.show();

		// Fold in contributed items after show() rather than awaiting them first:
		// getItems() is an extension-host RPC that can hang for seconds right after
		// a window reload, which would leave the picker invisible until it resolves.
		// When startup isn't Complete yet, the onDidChangeRuntimeStartupPhase
		// handler above does the fetch instead.
		if (languageRuntimeService.startupPhase === RuntimeStartupPhase.Complete) {
			fetchContributedItems().then(() => {
				// Skip if the user dismissed the picker while the fetch was pending.
				if (!disposables.isDisposed) {
					rebuildItems();
				}
			});
		}
	});
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
		prompt: localize('positron.languageRuntime.renameSession.prompt', "Enter the new session name"),
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
			localize('positron.languageRuntime.renameSession.error',
				"Failed to rename session {0}: {1}",
				sessionId,
				error
			)
		);
	}
};

/**
 * Action that allows the user to create a new console session based off the current active console session.
 * This utilizes the runtime data from the current session to create a new session.
 */
export class DuplicateActiveConsoleSessionAction extends Action2 {
	constructor() {
		super({
			icon: Codicon.plus,
			id: LANGUAGE_RUNTIME_DUPLICATE_ACTIVE_CONSOLE_SESSION_ID,
			title: localize2('positron.languageRuntime.duplicateActiveConsoleSession.title', 'Duplicate Active Console Session'),
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

		// Get the current foreground session.
		const currentSession = runtimeSessionService.foregroundSession;
		if (!currentSession) {
			return;
		}

		// Drive focus into the Positron console.
		commandService.executeCommand('workbench.panel.positronConsole.focus');

		// Start a new console session using the current session's runtime
		// information. When the current session is itself a console session,
		// this duplicates it. When it's a non-console session (e.g. a notebook
		// console), this starts a fresh console session in the same environment
		// rather than treating it as an error.
		if (currentSession.metadata.sessionMode === LanguageRuntimeSessionMode.Console) {
			await runtimeSessionService.startNewRuntimeSession(
				currentSession.runtimeMetadata.runtimeId,
				currentSession.dynState.sessionName,
				LanguageRuntimeSessionMode.Console,
				undefined,
				`Duplicated session: ${currentSession.dynState.sessionName}`,
				RuntimeStartMode.Starting,
				true
			);
		} else {
			await runtimeSessionService.startNewRuntimeSession(
				currentSession.runtimeMetadata.runtimeId,
				currentSession.runtimeMetadata.runtimeName,
				LanguageRuntimeSessionMode.Console,
				undefined,
				`Started console session from notebook session: ${currentSession.dynState.sessionName}`,
				RuntimeStartMode.Starting,
				true
			);
		}
	}
}

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
		title: ILocalizedString,
		action: (accessor: ServicesAccessor) => Promise<void>,
		keybinding: Omit<IKeybindingRule, 'id'>[] | undefined = undefined): void => {
		registerAction2(class extends Action2 {
			// Constructor.
			constructor() {
				super({
					id,
					title,
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
	 * NOTE: This is a convenience action that is used by the legacy notebook service
	 */
	registerAction2(class PickInterpreterAction extends Action2 {
		constructor() {
			super({
				id: LANGUAGE_RUNTIME_SELECT_LEGACY_NOTEBOOK_RUNTIME_ID,
				title: localize2('positron.command.selectInterpreter', "Select Interpreter"),
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
	registerLanguageRuntimeAction(
		'workbench.action.languageRuntime.clearAffiliatedRuntime',
		localize2('positron.languageRuntime.clearSavedInterpreter', 'Clear Saved Interpreter'),
		async accessor => {
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
				notificationService.info(localize('noInterpretersSaved', 'No interpreters are currently saved in this workspace.'));
				return;
			}

			// Prompt the user to select a language runtime.
			const quickPickItem = await quickInputService
				.pick<LanguageRuntimeQuickPickItem>(runtimeQuickPickItems, {
					canPickMany: false,
					placeHolder: localize('selectInterpreterToClear', 'Select interpreter to clear')
				});

			// User didn't select a runtime.
			if (!quickPickItem) {
				return;
			}

			// Clear the selected interpreter.
			runtimeSessionService.clearAffiliatedRuntime(quickPickItem.runtime.languageId);
			notificationService.info(localize('interpreterCleared', 'The {0} interpreter has been cleared from this workspace.', quickPickItem.runtime.runtimeName));
		});

	/**
	 * Action that allows the user to change the foreground session.
	 */
	registerLanguageRuntimeAction(
		LANGUAGE_RUNTIME_SELECT_SESSION_ID,
		localize2('positron.languageRuntime.selectSession.commandTitle', 'Select Session'),
		async accessor => {
			// Access services.
			const commandService = accessor.get(ICommandService);
			const editorService = accessor.get(IEditorService);
			const runtimeSessionService = accessor.get(IRuntimeSessionService);

			// Prompt the user to select a runtime to use.
			const newActiveSession = await selectLanguageRuntimeSession(accessor,
				{
					allowStartSession: true,
					title: localize('positron.languageRuntime.changeForegroundSession.quickPickTitle', 'Running Interpreter Sessions')
				}
			);

			if (!newActiveSession) {
				return;
			}

			const notebookUri = newActiveSession.metadata.notebookUri;
			if (notebookUri) {
				// For notebook sessions, we want to focus the editor
				// associated with the session's notebook URI when changing
				// the foreground session.
				await editorService.openEditor({ resource: notebookUri });
				runtimeSessionService.foregroundSession = newActiveSession;
			} else {
				// For console sessions, drive focus into the console pane
				runtimeSessionService.foregroundSession = newActiveSession;
				commandService.executeCommand('workbench.panel.positronConsole.focus');
			}
		}
	);

	/**
	 * Action that allows the user to create a new console session from a list of registered runtimes.
	 */
	registerAction2(class extends Action2 {
		/**
		 * Constructor.
		 */
		constructor() {
			super({
				icon: Codicon.plus,
				id: LANGUAGE_RUNTIME_START_NEW_CONSOLE_SESSION_ID,
				title: localize2('positron.languageRuntime.startConsoleSession', 'Start New Console Session'),
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
			const selectedRuntime = await selectNewLanguageRuntime(
				accessor,
				{ title: localize('positron.languageRuntime.startConsoleSession', 'Start New Console Session') }
			);

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
	 * Action that allows the user to rename an active session.
	 */
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: LANGUAGE_RUNTIME_RENAME_SESSION_ID,
				title: localize2('positron.languageRuntime.renameSession', "Rename Interpreter Session"),
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
				accessor, {
				includeNotebookSessions: false,
				title: localize('positron.languageRuntime.selectSessionToRename', 'Select Session To Rename'),
			});
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
				title: localize2('positron.languageRuntime.renameActiveSession', "Rename Active Interpreter Session"),
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
		localize2('positron.languageRuntime.restartActiveInterpreterSession', 'Restart Active Interpreter Session'),
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
	registerLanguageRuntimeAction(
		'workbench.action.languageRuntime.interrupt',
		localize2('positron.languageRuntime.interruptActiveInterpreterSession', 'Interrupt Active Interpreter Session'),
		async accessor => {
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
	registerLanguageRuntimeAction(
		'workbench.action.languageRuntime.forceQuit',
		localize2('positron.languageRuntime.forceQuitActiveInterpreterSession', 'Force Quit Active Interpreter Session'),
		async accessor => {
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
	registerLanguageRuntimeAction(
		'workbench.action.languageRuntime.showOutput',
		localize2('positron.languageRuntime.showActiveInterpreterSessionOutput', 'Show Active Interpreter Session Output'),
		async accessor => {
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
	registerLanguageRuntimeAction(
		'workbench.action.languageRuntime.showProfile',
		localize2('positron.languageRuntime.showActiveInterpreterSessionProfileReport', 'Show Active Interpreter Session Profile Report'),
		async accessor => {
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
				title: localize2('positron.command.openClient', "Create Runtime Client Widget"),
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
				title: localize2('positron.command.closeClient', "Close Runtime Client Widget"),
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
				placeHolder: localize('Client Close Selection Placeholder', 'Close Client for {0}', session.runtimeMetadata.runtimeName)
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
				title: localize2('workbench.action.language.runtime.discoverAllRuntimes', "Discover All Interpreters"),
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

	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: LANGUAGE_RUNTIME_CLEAR_INTERPRETER_CACHE_ID,
				title: localize2('workbench.action.language.runtime.clearInterpreterCache', "Clear Interpreter Cache"),
				f1: true,
				category
			});
		}

		async run(accessor: ServicesAccessor) {
			const cache = accessor.get(IRuntimeDiscoveryCache);
			const notificationService = accessor.get(INotificationService);
			cache.clear();
			notificationService.info(localize(
				'positron.runtimeStartupService.cacheClearedMessage',
				"Interpreter discovery cache cleared. Run Discover All Interpreters to repopulate it."));
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
				title: localize2('positron.command.executeCode.console', "Execute Code in Console"),
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
			const runtimeSessionService = accessor.get(IRuntimeSessionService);
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
					prompt: localize('positron.executeCode.prompt', "Enter the code to execute in {0}", langPick.label),
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
				const foreground = runtimeSessionService.foregroundSession;
				if (foreground) {
					args.langId = foreground.runtimeMetadata.languageId;
				} else {
					// Notify the user that there's no console for the language.
					notificationService.warn(localize('positron.execute.noConsole.active', "Cannot execute '{0}'; no console is active."));
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
				args.langId,
				undefined /* no particular session */,
				args.code,
				attribution,
				!!args.focus,
				true /* execute the code even if incomplete */);
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
				title: localize2('positron.command.executeCode.silently', "Execute Code Silently"),
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
				notificationService.warn(localize('positron.executeSilent.noConsole.active', "Cannot execute '{0}'; no {1} console is active.", args.code, languageName));
			}
		}
	});
}

registerAction2(class EvaluateCodeAction extends Action2 {

	constructor() {
		super({
			id: 'workbench.action.evaluateCode',
			title: localize2('positron.command.evaluateCode', "Evaluate Code"),
			f1: true,
			category
		});
	}

	/**
	 * Runs the Evaluate Code action.
	 *
	 * @param accessor The service accessor.
	 */
	async run(accessor: ServicesAccessor) {
		const runtimeSessionService = accessor.get(IRuntimeSessionService);
		const quickInputService = accessor.get(IQuickInputService);
		const notificationService = accessor.get(INotificationService);
		const progressService = accessor.get(IProgressService);
		const editorService = accessor.get(IEditorService);

		// Get the foreground session
		const foregroundSession = runtimeSessionService.foregroundSession;

		if (!foregroundSession) {
			notificationService.warn(
				localize('positron.evaluateCode.noSession', "No active interpreter session.")
			);
			return;
		}

		// Get the active runtime session wrapper (which has the UI client)
		const activeSession = runtimeSessionService.getActiveSession(foregroundSession.sessionId);

		if (!activeSession || !activeSession.uiClient) {
			notificationService.warn(
				localize('positron.evaluateCode.noUiClient', "Session does not support code evaluation.")
			);
			return;
		}

		// Prompt the user for code to evaluate
		const code = await quickInputService.input({
			prompt: localize('positron.evaluateCode.prompt', "Enter code to evaluate"),
			placeHolder: localize('positron.evaluateCode.placeholder', "Code expression"),
		});

		if (!code) {
			return;
		}

		// Truncate code for display in progress title
		const codeLabel = code.length > 50 ? code.substring(0, 50) + '...' : code;

		const languageId = foregroundSession.runtimeMetadata.languageId;

		// Build the input section (shared by success and error)
		const lines: string[] = [];
		lines.push('## Input');
		lines.push('');
		lines.push('```' + languageId + '');
		lines.push(code);
		lines.push('```');

		try {
			const result = await progressService.withProgress(
				{
					location: ProgressLocation.Notification,
					title: localize('positron.evaluateCode.evaluating', "Evaluating: {0}", codeLabel),
					delay: 500,
					cancellable: false,
				},
				() => activeSession.uiClient!.evaluateCode(code)
			);

			const resultStr = JSON.stringify(result.result, null, 2);

			lines.push('');
			lines.push('## Result');
			lines.push('');
			lines.push('```json');
			lines.push(resultStr);
			lines.push('```');
			if (result.output) {
				lines.push('');
				lines.push('## Output');
				lines.push('');
				lines.push('```');
				lines.push(result.output);
				lines.push('```');
			}
		} catch (err) {
			lines.push('');
			lines.push('## Error');
			lines.push('');
			lines.push('```');
			lines.push(getErrorMessage(err));
			lines.push('```');
		}

		await editorService.openEditor({
			resource: undefined,
			contents: lines.join('\n'),
			languageId: 'markdown',
		});
	}
});

registerAction2(class SetWorkingDirectoryCommand extends Action2 {
	// from explorer
	constructor() {
		super({
			id: 'workbench.action.setWorkingDirectory',
			title: localize2('setWorkingDirectory', "Set as Working Directory in Active Console"),
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
				localize('positron.setWorkingDirectory.noSession',
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
				openLabel: localize('positron.setWorkingDirectory.setDirectory',
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

/**
 * Action to reset the architecture mismatch warning so it shows again.
 * Useful for testing or if users change their mind.
 */
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'positron.interpreter.resetArchitectureMismatchWarning',
			title: localize2('positron.interpreter.resetArchMismatch', 'Reset Interpreter Architecture Mismatch Warning'),
			category: Categories.Developer,
			f1: true,
		});
	}

	run(accessor: ServicesAccessor): void {
		const runtimeStartupService = accessor.get(IRuntimeStartupService);
		const notificationService = accessor.get(INotificationService);

		runtimeStartupService.resetArchitectureMismatchWarning();
		notificationService.info(localize('positron.interpreter.archMismatchReset', 'Architecture mismatch warning has been reset. The warning will appear the next time you start an interpreter with a different architecture than your system.'));
	}
});

registerAction2(DuplicateActiveConsoleSessionAction);

CommandsRegistry.registerCommandAlias(
	'workbench.action.language.runtime.startNewSession',
	LANGUAGE_RUNTIME_START_NEW_CONSOLE_SESSION_ID
);
CommandsRegistry.registerCommandAlias(
	'workbench.action.language.runtime.duplicateActiveSession',
	LANGUAGE_RUNTIME_DUPLICATE_ACTIVE_CONSOLE_SESSION_ID
);
CommandsRegistry.registerCommandAlias(
	'workbench.action.languageRuntime.selectRuntime',
	LANGUAGE_RUNTIME_SELECT_LEGACY_NOTEBOOK_RUNTIME_ID
);
