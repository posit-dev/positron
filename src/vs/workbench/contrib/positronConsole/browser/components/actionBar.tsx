/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './actionBar.css';

// React.
import React, { useEffect, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { IReactComponentContainer } from '../../../../../base/browser/positronReactRenderer.js';
import { IsDevelopmentContext } from '../../../../../platform/contextkey/common/contextkeys.js';
import { PositronActionBar } from '../../../../../platform/positronActionBar/browser/positronActionBar.js';
import { UiFrontendEvent } from '../../../../services/languageRuntime/common/positronUiComm.js';
import { ActionBarRegion } from '../../../../../platform/positronActionBar/browser/components/actionBarRegion.js';
import { ActionBarButton } from '../../../../../platform/positronActionBar/browser/components/actionBarButton.js';
import { ActionBarSeparator } from '../../../../../platform/positronActionBar/browser/components/actionBarSeparator.js';
import { usePositronConsoleContext } from '../positronConsoleContext.js';
import { PositronActionBarContextProvider } from '../../../../../platform/positronActionBar/browser/positronActionBarContext.js';
import { PositronConsoleState } from '../../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { RuntimeExitReason, RuntimeState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession, RuntimeStartMode } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { ConsoleInstanceMenuButton } from './consoleInstanceMenuButton.js';
import { multipleConsoleSessionsFeatureEnabled } from '../../../../services/runtimeSession/common/positronMultipleConsoleSessionsFeatureFlag.js';
import { ConsoleInstanceInfoButton } from './consoleInstanceInfoButton.js';

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
		positronConsoleContext.positronConsoleService.onDidChangeActivePositronConsoleInstance(
			activePositronConsoleInstance => {
				setActivePositronConsoleInstance(activePositronConsoleInstance);
				setInterruptible(activePositronConsoleInstance?.state === PositronConsoleState.Busy);
				setInterrupting(false);
				setCanShutdown(activePositronConsoleInstance?.session.getRuntimeState() !== RuntimeState.Exited);
				setCanStart(activePositronConsoleInstance?.session.getRuntimeState() === RuntimeState.Exited);
			}
		);
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
			setCanShutdown(
				session.getRuntimeState() !== RuntimeState.Exited &&
				session.getRuntimeState() !== RuntimeState.Uninitialized);
			setCanStart(session.getRuntimeState() === RuntimeState.Exited ||
				session.getRuntimeState() === RuntimeState.Uninitialized);

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
			disposableRuntimeStore.add(session.onDidReceiveRuntimeClientEvent((event) => {
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
			}

			// Register for runtime changes.
			disposableConsoleStore.add(
				activePositronConsoleInstance.onDidAttachRuntime(attachRuntime));
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
		activePositronConsoleInstance?.session.interrupt();
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
		// Get the current session the console is bound to and its state.
		const session = positronConsoleContext.activePositronConsoleInstance?.session;
		if (!session) {
			return;
		}
		const state = session.getRuntimeState();

		if (state === RuntimeState.Exited || state === RuntimeState.Uninitialized) {
			// Start a new session if the current session has exited, or never
			// started (e.g. retrying after a startup failure)
			positronConsoleContext.runtimeSessionService.startNewRuntimeSession(
				session.runtimeMetadata.runtimeId,
				session.metadata.sessionName,
				session.metadata.sessionMode,
				session.metadata.notebookUri,
				`User-requested new session from console action bar ` +
				`after session ${session.metadata.sessionId} exited.`,
				RuntimeStartMode.Starting,
				false
			);
			return;
		} else {
			// Shutdown the current session.
			session.shutdown(
				RuntimeExitReason.Shutdown
			);
		}
	};

	// Restart console event handler.
	const restartConsoleHandler = async () => {
		positronConsoleContext.activePositronConsoleInstance?.session.restart();
	};

	// Render.
	return (
		<PositronActionBarContextProvider {...positronConsoleContext}>
			<div className='action-bar'>
				<PositronActionBar
					size='small'
					borderTop={true}
					borderBottom={true}
					paddingLeft={kPaddingLeft}
					paddingRight={kPaddingRight}
				>
					<ActionBarRegion location='left'>
						<ConsoleInstanceMenuButton {...props} />
						<div className='action-bar-separator' />
						{directoryLabel &&
							<div className='directory-label'
								aria-label={(() => localize(
									'directoryLabel',
									"Current Working Directory"
								))()}
							>
								<span className='codicon codicon-folder' role='presentation'></span>
								<span className='label' title={directoryLabel}>{directoryLabel}</span>
							</div>
						}
					</ActionBarRegion>
					<ActionBarRegion location='right'>
						<div className='state-label'>{stateLabel}</div>
						{interruptible &&
							<ActionBarButton
								fadeIn={true}
								disabled={interrupting}
								align='right'
								tooltip={positronInterruptExecution}
								ariaLabel={positronInterruptExecution}
								onPressed={interruptHandler}
							>
								<div className={
									`action-bar-button-icon
									interrupt
									codicon
									codicon-positron-interrupt-runtime`
								}
								/>
							</ActionBarButton>
						}
						{interruptible &&
							<ActionBarSeparator fadeIn={true} />
						}
						<ActionBarButton
							iconId='positron-power-button-thin'
							align='right'
							disabled={!(canShutdown || canStart)}
							tooltip={canStart ? positronStartConsole : positronShutdownConsole}
							ariaLabel={canStart ? positronStartConsole : positronShutdownConsole}
							onPressed={powerCycleConsoleHandler}
						/>
						<ActionBarButton
							iconId='positron-restart-runtime-thin'
							align='right'
							disabled={!canShutdown}
							tooltip={positronRestartConsole}
							ariaLabel={positronRestartConsole}
							onPressed={restartConsoleHandler}
						/>
						{multiSessionsEnabled && <ConsoleInstanceInfoButton />}
						<ActionBarSeparator />
						{showDeveloperUI &&
							<ActionBarButton
								iconId='wand'
								align='right'
								tooltip={positronToggleTrace}
								ariaLabel={positronToggleTrace}
								onPressed={toggleTraceHandler}
							/>
						}
						<ActionBarButton
							iconId='word-wrap'
							align='right'
							tooltip={positronToggleWordWrap}
							ariaLabel={positronToggleWordWrap}
							onPressed={toggleWordWrapHandler}
						/>
						<ActionBarSeparator />
						<ActionBarButton
							iconId='clear-all'
							align='right'
							tooltip={positronClearConsole}
							ariaLabel={positronClearConsole}
							onPressed={clearConsoleHandler}
						/>
					</ActionBarRegion>
				</PositronActionBar>
			</div>
		</PositronActionBarContextProvider>
	);
};
