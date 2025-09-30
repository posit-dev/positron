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
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { CurrentWorkingDirectory } from './currentWorkingDirectory.js';
import { usePositronConsoleContext } from '../positronConsoleContext.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ConsoleInstanceInfoButton } from './consoleInstanceInfoButton.js';
import { IReactComponentContainer } from '../../../../../base/browser/positronReactRenderer.js';
import { IsDevelopmentContext } from '../../../../../platform/contextkey/common/contextkeys.js';
import { UiFrontendEvent } from '../../../../services/languageRuntime/common/positronUiComm.js';
import { RuntimeState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { ActionBarButton } from '../../../../../platform/positronActionBar/browser/components/actionBarButton.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { PositronConsoleState } from '../../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { PositronActionBarContextProvider } from '../../../../../platform/positronActionBar/browser/positronActionBarContext.js';
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
const stateLabelReconnecting = localize('positronConsoleState.Reconnecting', "Reconnecting");

/**
 * Localized strings for UI.
 */
const positronInterruptExecution = localize('positronInterruptExecution', "Interrupt Execution");
const positronToggleTrace = localize('positronToggleTrace', "Toggle Trace");
const positronToggleWordWrap = localize('positronToggleWordWrap', "Toggle Word Wrap");
const positronClearConsole = localize('positronClearConsole', "Clear Console");
const positronOpenInEditor = localize('positronOpenInEditor', "Open in Editor");
const positronDeleteSession = localize('positronDeleteSession', "Delete Session");

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
			return stateLabelReconnecting;

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
	const services = usePositronReactServicesContext();
	const positronConsoleContext = usePositronConsoleContext();

	// Constants.
	const showDeveloperUI = IsDevelopmentContext.getValue(services.contextKeyService);

	// State hooks.
	const [activePositronConsoleInstance, setActivePositronConsoleInstance] = useState(services.positronConsoleService.activePositronConsoleInstance);

	// Hooks to track when the console can be interrupted and when the interrupt is in progress.
	const [interruptible, setInterruptible] = useState(false);
	const [interrupting, setInterrupting] = useState(false);
	// Hook to track when the console can be shutdown and restarted
	// since a restart requires the session kernel to be shutdown.
	const [canShutdown, setCanShutdown] = useState(false);
	// Hook to track when the console can be started.
	const [canStart, setCanStart] = useState(false);

	/**
	 * Hook to track when a restart is in progress
	 * This is used to disable the restart button
	 * and to keep the state label until the restart completes.
	 */
	const [restarting, setRestarting] = useState(false);

	const [stateLabel, setStateLabel] = useState('');
	const [directoryLabel, setDirectoryLabel] = useState('');

	// Localized strings with placeholders
	const positronRestartSession = localize('positronRestartSession', "Restart {0}", activePositronConsoleInstance?.runtimeMetadata.languageName ?? localize('positronSession', "Session"));

	// Main useEffect hook.
	useEffect(() => {
		const disposables = new DisposableStore();
		// Register for active Positron console instance changes.
		disposables.add(services.positronConsoleService.onDidChangeActivePositronConsoleInstance(activePositronConsoleInstance => {
			setActivePositronConsoleInstance(activePositronConsoleInstance);
			setInterruptible(activePositronConsoleInstance?.state === PositronConsoleState.Busy);
			setInterrupting(false);
			setCanShutdown(activePositronConsoleInstance?.attachedRuntimeSession?.getRuntimeState() !== RuntimeState.Exited);
			setCanStart(activePositronConsoleInstance?.attachedRuntimeSession?.getRuntimeState() === RuntimeState.Exited);
		}));
		return () => {
			disposables.dispose();
		};
	}, [services.positronConsoleService]);

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
				// If a restart is in progress, we want to keep the state label as is until the restart completes.
				if (!restarting) { setStateLabel(''); }
				setInterruptible(false);
				setInterrupting(false);
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

			/**
			 * Listen for state changes.
			 *
			 * There is special handling of the state label when a session is restarting.
			 * The "Restarting" state is a transient state that signals the session has
			 * started the restart process.
			 *
			 * The actual state changes for a restart are as follows:
			 * 1. "Restarting": The restart state is a signal that the runtime is being restarted.
			 * 2. "Busy"/"Idle": The kernel state changes to "Busy" while the shutdown request is
			 *                   being handled and changes to "Idle" once complete.
			 * 3. "Exited": The kernal has shut down.
			 * 4. "Ready": The kernel started back up and is ready.
			 *
			 * To ensure the state label is not cleared while the session is restarting,
			 * we check if the `restarting` state is true. If it is, we keep the state label
			 * as "Restarting" until the restart completes.
			 */
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
						if (!restarting) { setStateLabel(''); }
						setInterruptible(false);
						setInterrupting(false);
						setCanShutdown(true);
						setCanStart(false);
						break;

					case RuntimeState.Busy:
						setStateLabel(labelForState(state));
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
						if (!restarting) { setStateLabel(''); }
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
	}, [activePositronConsoleInstance, restarting]);

	// Interrupt handler.
	const interruptHandler = async () => {
		// Set the interrupting flag to debounch the button.
		setInterrupting(true);

		// Interrupt the active Positron console instance.
		activePositronConsoleInstance?.interrupt();
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

	// Restart console event handler.
	const restartConsoleHandler = async () => {
		if (!positronConsoleContext.activePositronConsoleInstance) {
			return;
		}

		setRestarting(true);
		await services.runtimeSessionService.restartSession(
			activePositronConsoleInstance!.sessionId,
			'User-requested restart from console action bar'
		);
		setRestarting(false);
	};

	const deleteSessionHandler = async () => {
		if (!positronConsoleContext.activePositronConsoleInstance) {
			return;
		}

		await services.runtimeSessionService.deleteSession(
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
		services.editorService.openEditor({
			resource: undefined,
			languageId: positronConsoleContext.activePositronConsoleInstance.runtimeMetadata.languageId,
			contents: positronConsoleContext.activePositronConsoleInstance.getClipboardRepresentation('# ').join('\n'),
		});
	};

	// Left actions.
	const leftActions: DynamicActionBarAction[] = [
		// Current working directory.
		{
			fixedWidth: DEFAULT_ACTION_BAR_BUTTON_WIDTH,
			text: directoryLabel,
			separator: false,
			component: <CurrentWorkingDirectory directoryLabel={directoryLabel} />
		}
	];

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

	// Restart action.
	rightActions.push({
		fixedWidth: DEFAULT_ACTION_BAR_BUTTON_WIDTH,
		separator: true,
		component: (
			<ActionBarButton
				align='right'
				ariaLabel={positronRestartSession}
				dataTestId='restart-session'
				disabled={!canShutdown || restarting}
				icon={ThemeIcon.fromId('positron-restart-runtime-thin')}
				tooltip={(positronRestartSession)}
				onPressed={restartConsoleHandler}
			/>
		),
		overflowContextMenuItem: {
			commandId: 'positron.restartRuntime',
			icon: 'positron-restart-runtime-thin',
			label: positronRestartSession,
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
					ariaLabel={positronDeleteSession}
					dataTestId='trash-session'
					disabled={!(canShutdown || canStart)}
					icon={ThemeIcon.fromId('trash')}
					tooltip={positronDeleteSession}
					onPressed={deleteSessionHandler}
				/>
			),
			overflowContextMenuItem: {
				commandId: 'positron.trashSession',
				icon: 'trash',
				label: positronDeleteSession,
				onSelected: deleteSessionHandler
			}
		});
	}

	// Console info action.
	rightActions.push({
		fixedWidth: DEFAULT_ACTION_BAR_BUTTON_WIDTH,
		separator: true,
		component: <ConsoleInstanceInfoButton />,
	})


	// Toggle trace action.
	if (showDeveloperUI) {
		rightActions.push({
			fixedWidth: DEFAULT_ACTION_BAR_BUTTON_WIDTH,
			separator: false,
			component: (
				<ActionBarButton
					align='right'
					ariaLabel={positronToggleTrace}
					icon={ThemeIcon.fromId('wand')}
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
				icon={ThemeIcon.fromId('word-wrap')}
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
				icon={ThemeIcon.fromId('positron-open-in-editor')}
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
				icon={ThemeIcon.fromId('clear-all')}
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
			<PositronDynamicActionBar
				borderBottom={true}
				borderTop={true}
				leftActions={leftActions}
				paddingLeft={kPaddingLeft}
				paddingRight={kPaddingRight}
				rightActions={rightActions}
			/>
		</PositronActionBarContextProvider>
	);
};
