/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./actionBar';
import * as React from 'react';
import { useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { localize } from 'vs/nls';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { IReactComponentContainer } from 'vs/base/browser/positronReactRenderer';
import { IsDevelopmentContext } from 'vs/platform/contextkey/common/contextkeys';
import { PositronActionBar } from 'vs/platform/positronActionBar/browser/positronActionBar';
import { UiFrontendEvent } from 'vs/workbench/services/languageRuntime/common/positronUiComm';
import { ActionBarRegion } from 'vs/platform/positronActionBar/browser/components/actionBarRegion';
import { ActionBarButton } from 'vs/platform/positronActionBar/browser/components/actionBarButton';
import { ActionBarSeparator } from 'vs/platform/positronActionBar/browser/components/actionBarSeparator';
import { usePositronConsoleContext } from 'vs/workbench/contrib/positronConsole/browser/positronConsoleContext';
import { PositronActionBarContextProvider } from 'vs/platform/positronActionBar/browser/positronActionBarContext';
import { PositronConsoleState } from 'vs/workbench/services/positronConsole/browser/interfaces/positronConsoleService';
import { RuntimeExitReason, RuntimeState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { ILanguageRuntimeSession } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';
import { ConsoleInstanceMenuButton } from 'vs/workbench/contrib/positronConsole/browser/components/consoleInstanceMenuButton';

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

	// State hooks.
	const [activePositronConsoleInstance, setActivePositronConsoleInstance] =
		useState(positronConsoleContext.positronConsoleService.activePositronConsoleInstance);
	const [interruptible, setInterruptible] = useState(false);
	const [interrupting, setInterrupting] = useState(false);
	const [canShutdown, setCanShutdown] = useState(false);
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
			}
		);
	}, []);

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
				return;
			}

			// Set the initial state.
			setInterruptible(session.dynState.busy);
			setDirectoryLabel(session.dynState.currentWorkingDirectory);
			setCanShutdown(session.getRuntimeState() !== RuntimeState.Exited);

			// Listen for state changes.
			disposableRuntimeStore.add(session.onDidChangeRuntimeState((state) => {
				switch (state) {
					case RuntimeState.Starting:
						setStateLabel(labelForState(state));
						setInterruptible(false);
						setCanShutdown(false);
						break;

					case RuntimeState.Restarting:
						setStateLabel(labelForState(state));
						setInterrupting(false);
						setInterruptible(false);
						setCanShutdown(false);
						break;

					case RuntimeState.Idle:
					case RuntimeState.Ready:
						setStateLabel('');
						setInterruptible(false);
						setInterrupting(false);
						setCanShutdown(true);
						break;

					case RuntimeState.Busy:
						setInterruptible(true);
						setCanShutdown(true);
						break;

					case RuntimeState.Interrupting:
						setStateLabel(labelForState(state));
						setInterrupting(true);
						setCanShutdown(true);
						break;

					case RuntimeState.Offline:
						setStateLabel(labelForState(state));
						setInterruptible(false);
						setCanShutdown(false);
						break;

					case RuntimeState.Exiting:
						setStateLabel(labelForState(state));
						setInterrupting(false);
						setInterruptible(false);
						setCanShutdown(false);
						break;

					case RuntimeState.Exited:
						setStateLabel('');
						setInterrupting(false);
						setInterruptible(false);
						setCanShutdown(false);
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

	// Shutdown console event handler.
	const shutdownConsoleHandler = async () => {
		positronConsoleContext.activePositronConsoleInstance?.session.shutdown(
			RuntimeExitReason.Shutdown
		);
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
								aria-label={
									localize('directoryLabel', "Current Working Directory")
								}>
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
							<ActionBarSeparator />
						}
						<ActionBarButton
							iconId='positron-power-button'
							align='right'
							disabled={!canShutdown}
							tooltip={positronShutdownConsole}
							ariaLabel={positronShutdownConsole}
							onPressed={shutdownConsoleHandler}
						/>
						<ActionBarButton
							iconId='positron-restart-runtime'
							align='right'
							disabled={!canShutdown}
							tooltip={positronRestartConsole}
							ariaLabel={positronRestartConsole}
							onPressed={restartConsoleHandler}
						/>
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
