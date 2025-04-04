/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './actionBar.css';

// React.
import React, { useEffect, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { CurrentWorkingDirectory } from './currentWorkingDirectory.js';
import { usePositronConsoleContext } from '../positronConsoleContext.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ConsoleInstanceMenuButton } from './consoleInstanceMenuButton.js';
import { ConsoleInstanceInfoButton } from './consoleInstanceInfoButton.js';
import { IReactComponentContainer } from '../../../../../base/browser/positronReactRenderer.js';
import { IsDevelopmentContext } from '../../../../../platform/contextkey/common/contextkeys.js';
import { UiFrontendEvent } from '../../../../services/languageRuntime/common/positronUiComm.js';
import { ActionBarButton } from '../../../../../platform/positronActionBar/browser/components/actionBarButton.js';
import { RuntimeExitReason, RuntimeState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { PositronConsoleState } from '../../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { ILanguageRuntimeSession, RuntimeStartMode } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { PositronActionBarContextProvider } from '../../../../../platform/positronActionBar/browser/positronActionBarContext.js';
import { multipleConsoleSessionsFeatureEnabled } from '../../../../services/runtimeSession/common/positronMultipleConsoleSessionsFeatureFlag.js';
import { PositronDynamicActionBar, DynamicActionBarAction, DEFAULT_ACTION_BAR_BUTTON_WIDTH } from '../../../../../platform/positronActionBar/browser/positronDynamicActionBar.js';

/**
 * Constants.
 */
const kPaddingLeft = 8;
const kPaddingRight = 8;

/**
 * ActionBarProps interface.
 */
interface ActionBarProps {
	readonly reactComponentContainer: IReactComponentContainer;
	readonly showDeleteButton?: boolean;
}

/**
 * Localized strings for transitional/transient states.
 */
const stateLabelStarting = localize('positronConsoleState.Starting', "Starting");
const stateLabelInterrupting = localize('positronConsoleState.Interrupting', "Interrupting");
const stateLabelShuttingDown = localize('positronConsoleState.ShuttingDown', "Shutting down");
const stateLabelRestarting = localize('positronConsoleState.Restarting', "Restarting");
const stateLabelReconecting = localize('positronConsoleState.Reconnecting', "Reconnecting");

/**
 * Localized strings for UI.
 */
const positronInterruptExecution = localize('positronInterruptExecution', "Interrupt execution");
const positronToggleTrace = localize('positronToggleTrace', "Toggle trace");
const positronToggleWordWrap = localize('positronToggleWordWrap', "Toggle word wrap");
const positronClearConsole = localize('positronClearConsole', "Clear console");
const positronRestartConsole = localize('positronRestartConsole', "Restart console");
const positronShutdownConsole = localize('positronShutdownConsole', "Shutdown console");
const positronStartConsole = localize('positronStartConsole', "Start console");
const positronDeleteConsole = localize('positronDeleteConsole', "Delete console");
const positronOpenInEditor = localize('positronOpenInEditor', "Open in editor");

/**
 * Provides a localized label for the given runtime state. Only the transient
 * states are localized; we don't show a label for states that persist
 * indefinitely.
 *
 * @param state The transitional state.
 * @returns The localized label.
 */
function labelForState(state: RuntimeState): string {
	switch (state) {
		case RuntimeState.Starting:
			return stateLabelStarting;

		case RuntimeState.Restarting:
			return stateLabelRestarting;

		case RuntimeState.Interrupting:
			return stateLabelInterrupting;

		case RuntimeState.Exiting:
			return stateLabelShuttingDown;

		case RuntimeState.Offline:
			// We attempt to reconnect to the runtime when it goes offline.
			return stateLabelReconecting;

		default:
			return '';
	}
}

/**
 * ActionBar component.
 * @param props An ActionBarProps that contains the component properties.
 * @returns The rendered component.
 */
export const ActionBar = (props: ActionBarProps) => {
	// Context hooks.
	const positronConsoleContext = usePositronConsoleContext();

	// Constants.
	const showDeveloperUI = IsDevelopmentContext.getValue(positronConsoleContext.contextKeyService);
	const multiSessionsEnabled = multipleConsoleSessionsFeatureEnabled(positronConsoleContext.configurationService);

	// State hooks.
	const [activePositronConsoleInstance, setActivePositronConsoleInstance] =
		useState(positronConsoleContext.positronConsoleService.activePositronConsoleInstance);
	const [interruptible, setInterruptible] = useState(false);
	const [interrupting, setInterrupting] = useState(false);
	const [canShutdown, setCanShutdown] = useState(false);
	const [canStart, setCanStart] = useState(false);
	const [stateLabel, setStateLabel] = useState('');
	const [directoryLabel, setDirectoryLabel] = useState('');

	// Main useEffect hook.
	useEffect(() => {
		// Register for active Positron console instance changes.
		positronConsoleContext.positronConsoleService.onDidChangeActivePositronConsoleInstance(activePositronConsoleInstance => {
			setActivePositronConsoleInstance(activePositronConsoleInstance);
			setInterruptible(activePositronConsoleInstance?.state === PositronConsoleState.Busy);
			setInterrupting(false);
			setCanShutdown(activePositronConsoleInstance?.attachedRuntimeSession?.getRuntimeState() !== RuntimeState.Exited);
			setCanStart(activePositronConsoleInstance?.attachedRuntimeSession?.getRuntimeState() === RuntimeState.Exited);
		});
	}, [positronConsoleContext.positronConsoleService]);

	// Active Positron console instance useEffect hook.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableConsoleStore = new DisposableStore();
		const disposableRuntimeStore = new DisposableStore();

		const attachRuntime = (session: ILanguageRuntimeSession | undefined) => {
			// Detach from the previous runtime, if any.
			disposableRuntimeStore.clear();

			// If there is no runtime; we're done. This happens when the console
			// instance is detached from the runtime.
			if (!session) {
				setInterruptible(false);
				setInterrupting(false);
				setStateLabel('');
				setDirectoryLabel('');
				setCanShutdown(false);
				setCanStart(true);
				return;
			}

			// Set the initial state.
			setInterruptible(session.dynState.busy);
			setDirectoryLabel(session.dynState.currentWorkingDirectory);
			setCanShutdown(session.getRuntimeState() !== RuntimeState.Exited && session.getRuntimeState() !== RuntimeState.Uninitialized);
			setCanStart(session.getRuntimeState() === RuntimeState.Exited || session.getRuntimeState() === RuntimeState.Uninitialized);

			// Listen for state changes.
			disposableRuntimeStore.add(session.onDidChangeRuntimeState((state) => {
				switch (state) {
					case RuntimeState.Uninitialized:
						setStateLabel(labelForState(state));
						setInterruptible(false);
						setCanShutdown(false);
						setCanStart(true);
						break;

					case RuntimeState.Starting:
						setStateLabel(labelForState(state));
						setInterruptible(false);
						setCanShutdown(false);
						setCanStart(false);
						break;

					case RuntimeState.Restarting:
						setStateLabel(labelForState(state));
						setInterrupting(false);
						setInterruptible(false);
						setCanShutdown(false);
						setCanStart(false);
						break;

					case RuntimeState.Idle:
					case RuntimeState.Ready:
						setStateLabel('');
						setInterruptible(false);
						setInterrupting(false);
						setCanShutdown(true);
						setCanStart(false);
						break;

					case RuntimeState.Busy:
						setInterruptible(true);
						setCanShutdown(true);
						setCanStart(false);
						break;

					case RuntimeState.Interrupting:
						setStateLabel(labelForState(state));
						setInterrupting(true);
						setCanShutdown(true);
						setCanStart(false);
						break;

					case RuntimeState.Offline:
						setStateLabel(labelForState(state));
						setInterruptible(false);
						setCanShutdown(false);
						setCanStart(false);
						break;

					case RuntimeState.Exiting:
						setStateLabel(labelForState(state));
						setInterrupting(false);
						setInterruptible(false);
						setCanShutdown(false);
						setCanStart(false);
						break;

					case RuntimeState.Exited:
						setStateLabel('');
						setInterrupting(false);
						setInterruptible(false);
						setCanShutdown(false);
						setCanStart(true);
						break;
				}
			}));

			// Listen for changes to the working directory.
			disposableRuntimeStore.add(session.onDidReceiveRuntimeClientEvent(event => {
				if (event.name === UiFrontendEvent.WorkingDirectory) {
					setDirectoryLabel(session.dynState.currentWorkingDirectory);
				}
			}));
		};

		// If there is an active Positron console instance, see which runtime it's attached to.
		if (activePositronConsoleInstance) {
			// Attach to the console's current runtime, if any
			const session = activePositronConsoleInstance.attachedRuntimeSession;
			if (session) {
				attachRuntime(session);
			} else {
				// If no session yet, we can at least show the directory label
				// while it reconnects
				setDirectoryLabel(activePositronConsoleInstance.initialWorkingDirectory);
			}

			// Register for runtime changes.
			disposableConsoleStore.add(activePositronConsoleInstance.onDidAttachSession(attachRuntime));
		}

		// Return the cleanup function that will dispose of the disposables.
		return () => {
			disposableConsoleStore.dispose();
			disposableRuntimeStore.dispose();
		};
	}, [activePositronConsoleInstance]);

	// Interrupt handler.
	const interruptHandler = async () => {
		// Set the interrupting flag to debounch the button.
		setInterrupting(true);

		// Interrupt the active Positron console instance.
		activePositronConsoleInstance?.attachedRuntimeSession?.interrupt();
	};

	// Toggle trace event handler.
	const toggleTraceHandler = async () => {
		positronConsoleContext.activePositronConsoleInstance?.toggleTrace();
	};

	// Toggle word wrap event handler.
	const toggleWordWrapHandler = async () => {
		positronConsoleContext.activePositronConsoleInstance?.toggleWordWrap();
	};

	// Clear console event handler.
	const clearConsoleHandler = async () => {
		positronConsoleContext.activePositronConsoleInstance?.clearConsole();
	};

	// Power cycle (start or stop) console event handler.
	const powerCycleConsoleHandler = async () => {
		// Ensure we're acting on a valid console instance.
		if (!positronConsoleContext.activePositronConsoleInstance) {
			return;
		}

		// Get the current session the console is bound to and its state.
		const consoleInstance = positronConsoleContext.activePositronConsoleInstance;
		const session = consoleInstance.attachedRuntimeSession;

		// If no session, treat state as uninitialized.
		const state = session ? session.getRuntimeState() : RuntimeState.Uninitialized;

		if (state === RuntimeState.Exited || state === RuntimeState.Uninitialized) {
			const runtimeMetadata = consoleInstance.runtimeMetadata;
			const sessionMetadata = consoleInstance.sessionMetadata;

			// Start a new session if the current session has exited, or never
			// started (e.g. retrying after a startup failure)
			positronConsoleContext.runtimeSessionService.startNewRuntimeSession(
				runtimeMetadata.runtimeId,
				sessionMetadata.sessionName,
				sessionMetadata.sessionMode,
				sessionMetadata.notebookUri,
				`User-requested new session from console action bar ` +
				`after session ${sessionMetadata.sessionId} exited.`,
				RuntimeStartMode.Starting,
				false
			);
		} else {
			// Shutdown the current session.
			session?.shutdown(
				RuntimeExitReason.Shutdown
			);
		}
	};

	// Restart console event handler.
	const restartConsoleHandler = async () => {
		if (!positronConsoleContext.activePositronConsoleInstance) {
			return;
		}
		positronConsoleContext.runtimeSessionService.restartSession(
			activePositronConsoleInstance!.sessionId,
			'User-requested restart from console action bar'
		);
	};

	const deleteSessionHandler = async () => {
		if (!positronConsoleContext.activePositronConsoleInstance) {
			return;
		}

		await positronConsoleContext.runtimeSessionService.deleteSession(
			positronConsoleContext.activePositronConsoleInstance.sessionId
		);
	};

	// Open in editor event handler.
	const openInEditorHandler = async () => {
		// Ensure we're acting on a valid console instance.
		if (!positronConsoleContext.activePositronConsoleInstance) {
			return;
		}

		// Open an editor on the clipboard representation of the active console. R and Python use the same comment prefix,
		// so nothing more fancy is needed.
		positronConsoleContext.editorService.openEditor({
			resource: undefined,
			languageId: positronConsoleContext.activePositronConsoleInstance.runtimeMetadata.languageId,
			contents: positronConsoleContext.activePositronConsoleInstance.getClipboardRepresentation('# ').join('\n'),
		});
	};

	// Left actions.
	const leftActions: DynamicActionBarAction[] = [];

	// Console instance menu button.
	if (!multiSessionsEnabled) {
		leftActions.push({
			fixedWidth: 20,
			text: positronConsoleContext.activePositronConsoleInstance?.sessionMetadata.sessionName,
			separator: true,
			component: <ConsoleInstanceMenuButton {...props} />
		});
	}

	// Current working directory.
	leftActions.push({
		fixedWidth: DEFAULT_ACTION_BAR_BUTTON_WIDTH,
		text: directoryLabel,
		separator: false,
		component: <CurrentWorkingDirectory directoryLabel={directoryLabel} />
	});

	// Right actions.
	const rightActions: DynamicActionBarAction[] = [];

	// State label.
	if (stateLabel.length) {
		rightActions.push({
			fixedWidth: 4,
			text: stateLabel,
			separator: false,
			component: <div className='state-label'>{stateLabel}</div>
		});
	}

	// Interrupt action.
	if (interruptible) {
		rightActions.push({
			fixedWidth: DEFAULT_ACTION_BAR_BUTTON_WIDTH,
			separator: false,
			component: (
				<ActionBarButton
					align='right'
					ariaLabel={positronInterruptExecution}
					disabled={interrupting}
					fadeIn={true}
					tooltip={positronInterruptExecution}
					onPressed={interruptHandler}
				>
					<div className={'action-bar-button-icon	interrupt codicon codicon-positron-interrupt-runtime'} />
				</ActionBarButton>
			)
		});
	}

	// Power action.
	if (!multiSessionsEnabled) {
		rightActions.push({
			fixedWidth: DEFAULT_ACTION_BAR_BUTTON_WIDTH,
			separator: false,
			component: (
				<ActionBarButton
					align='right'
					ariaLabel={canStart ? positronStartConsole : positronShutdownConsole}
					disabled={!(canShutdown || canStart)}
					iconId='positron-power-button-thin'
					tooltip={canStart ? positronStartConsole : positronShutdownConsole}
					onPressed={powerCycleConsoleHandler}
				/>
			)
		});
	}

	// Restart action.
	rightActions.push({
		fixedWidth: DEFAULT_ACTION_BAR_BUTTON_WIDTH,
		separator: true,
		component: (
			<ActionBarButton
				align='right'
				ariaLabel={positronRestartConsole}
				disabled={!canShutdown}
				iconId='positron-restart-runtime-thin'
				tooltip={positronRestartConsole}
				onPressed={restartConsoleHandler}
			/>
		),
		overflowContextMenuItem: {
			commandId: 'positron.restartRuntime',
			icon: 'positron-restart-runtime-thin',
			label: positronRestartConsole,
			onSelected: restartConsoleHandler
		}
	});

	// Delete session action.
	if (props.showDeleteButton) {
		rightActions.push({
			fixedWidth: DEFAULT_ACTION_BAR_BUTTON_WIDTH,
			separator: false,
			component: (
				<ActionBarButton
					align='right'
					ariaLabel={positronDeleteConsole}
					dataTestId='trash-session'
					disabled={!(canShutdown || canStart)}
					iconId='trash'
					tooltip={positronDeleteConsole}
					onPressed={deleteSessionHandler}
				/>
			),
			overflowContextMenuItem: {
				commandId: 'positron.trashSession',
				icon: 'trash',
				label: positronDeleteConsole,
				onSelected: deleteSessionHandler
			}
		});
	}

	// Console info action.
	if (multiSessionsEnabled) {
		rightActions.push({
			fixedWidth: DEFAULT_ACTION_BAR_BUTTON_WIDTH,
			separator: true,
			component: <ConsoleInstanceInfoButton />,
		})
	}

	// Toggle trace action.
	if (showDeveloperUI) {
		rightActions.push({
			fixedWidth: DEFAULT_ACTION_BAR_BUTTON_WIDTH,
			separator: false,
			component: (
				<ActionBarButton
					align='right'
					ariaLabel={positronToggleTrace}
					iconId='wand'
					tooltip={positronToggleTrace}
					onPressed={toggleTraceHandler}
				/>
			),
			overflowContextMenuItem: {
				commandId: 'positron.toggleTrace',
				icon: 'wand',
				label: positronToggleTrace,
				onSelected: toggleTraceHandler
			}
		})
	}

	// Toggle word wrap action.
	rightActions.push({
		fixedWidth: DEFAULT_ACTION_BAR_BUTTON_WIDTH,
		separator: true,
		component: (
			<ActionBarButton
				align='right'
				ariaLabel={positronToggleWordWrap}
				iconId='word-wrap'
				tooltip={positronToggleWordWrap}
				onPressed={toggleWordWrapHandler}
			/>
		),
		overflowContextMenuItem: {
			commandId: 'positron.toggleWordWrap',
			icon: 'word-wrap',
			label: positronToggleWordWrap,
			onSelected: toggleWordWrapHandler
		}
	})

	// Open in editor action.
	rightActions.push({
		fixedWidth: DEFAULT_ACTION_BAR_BUTTON_WIDTH,
		separator: true,
		component: (
			<ActionBarButton
				align='right'
				ariaLabel={positronOpenInEditor}
				iconId='positron-open-in-editor'
				tooltip={positronOpenInEditor}
				onPressed={openInEditorHandler}
			/>
		),
		overflowContextMenuItem: {
			commandId: 'positron.openInEditor',
			icon: 'positron-open-in-editor',
			label: positronOpenInEditor,
			onSelected: openInEditorHandler
		}
	});

	// Clear console action.
	rightActions.push({
		fixedWidth: DEFAULT_ACTION_BAR_BUTTON_WIDTH,
		separator: false,
		component: (
			<ActionBarButton
				align='right'
				ariaLabel={positronClearConsole}
				iconId='clear-all'
				tooltip={positronClearConsole}
				onPressed={clearConsoleHandler}
			/>
		),
		overflowContextMenuItem: {
			commandId: 'positron.clearConsole',
			icon: 'clear-all',
			label: positronClearConsole,
			onSelected: clearConsoleHandler
		}
	});

	// Render.
	return (
		<PositronActionBarContextProvider {...positronConsoleContext}>
			<div className='action-bar'>
				<PositronDynamicActionBar
					borderBottom={true}
					borderTop={true}
					leftActions={leftActions}
					paddingLeft={kPaddingLeft}
					paddingRight={kPaddingRight}
					rightActions={rightActions}
					size='small'
				/>
			</div>
		</PositronActionBarContextProvider>
	);
};
