/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./actionBar';
import * as React from 'react';
import { useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { localize } from 'vs/nls';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { IReactComponentContainer } from 'vs/base/browser/positronReactRenderer';
import { IsDevelopmentContext } from 'vs/platform/contextkey/common/contextkeys';
import { PositronActionBar } from 'vs/platform/positronActionBar/browser/positronActionBar';
import { ActionBarRegion } from 'vs/platform/positronActionBar/browser/components/actionBarRegion';
import { ActionBarButton } from 'vs/platform/positronActionBar/browser/components/actionBarButton';
import { ActionBarSeparator } from 'vs/platform/positronActionBar/browser/components/actionBarSeparator';
import { LanguageRuntimeEventType } from 'vs/workbench/services/languageRuntime/common/languageRuntimeEvents';
import { usePositronConsoleContext } from 'vs/workbench/contrib/positronConsole/browser/positronConsoleContext';
import { PositronActionBarContextProvider } from 'vs/platform/positronActionBar/browser/positronActionBarContext';
import { ILanguageRuntime, RuntimeState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { PositronConsoleState } from 'vs/workbench/services/positronConsole/browser/interfaces/positronConsoleService';
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
			}
		);
	}, []);

	// Active Positron console instance useEffect hook.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableConsoleStore = new DisposableStore();
		const disposableRuntimeStore = new DisposableStore();

		const attachRuntime = (runtime: ILanguageRuntime | undefined) => {
			// Detach from the previous runtime, if any.
			disposableRuntimeStore.clear();

			// If there is no runtime; we're done. This happens when the console
			// instance is detached from the runtime.
			if (!runtime) {
				setInterruptible(false);
				setInterrupting(false);
				setStateLabel('');
				setDirectoryLabel('');
				return;
			}

			// Set the initial state.
			setInterruptible(runtime.dynState.busy);
			setDirectoryLabel(runtime.dynState.currentWorkingDirectory);

			// Listen for state changes.
			disposableRuntimeStore.add(runtime.onDidChangeRuntimeState((state) => {
				switch (state) {
					case RuntimeState.Starting:
						setStateLabel(labelForState(state));
						setInterruptible(false);
						break;

					case RuntimeState.Restarting:
						setStateLabel(labelForState(state));
						setInterrupting(false);
						setInterruptible(false);
						break;

					case RuntimeState.Idle:
					case RuntimeState.Ready:
						setStateLabel('');
						setInterruptible(false);
						setInterrupting(false);
						break;

					case RuntimeState.Busy:
						setInterruptible(true);
						break;

					case RuntimeState.Interrupting:
						setStateLabel(labelForState(state));
						setInterrupting(true);
						break;

					case RuntimeState.Offline:
						setStateLabel(labelForState(state));
						setInterruptible(false);
						break;

					case RuntimeState.Exiting:
						setStateLabel(labelForState(state));
						setInterrupting(false);
						setInterruptible(false);
						break;

					case RuntimeState.Exited:
						setStateLabel('');
						setInterrupting(false);
						setInterruptible(false);
						break;
				}
			}));

			// Listen for changes to the working directory.
			disposableRuntimeStore.add(runtime.onDidReceiveRuntimeClientEvent((event) => {
				if (event.name === LanguageRuntimeEventType.WorkingDirectory) {
					setDirectoryLabel(runtime.dynState.currentWorkingDirectory);
				}
			}));
		};

		// If there is an active Positron console instance, see which runtime it's attached to.
		if (activePositronConsoleInstance) {
			// Attach to the console's current runtime, if any
			const runtime = activePositronConsoleInstance.attachedRuntime;
			if (runtime) {
				attachRuntime(runtime);
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
		activePositronConsoleInstance?.runtime.interrupt();
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
								onClick={interruptHandler}
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
						{showDeveloperUI &&
							<ActionBarButton
								iconId='positron-list'
								align='right'
								tooltip={positronToggleTrace}
								ariaLabel={positronToggleTrace}
								onClick={toggleTraceHandler}
							/>
						}
						<ActionBarButton
							iconId='word-wrap'
							align='right'
							tooltip={positronToggleWordWrap}
							ariaLabel={positronToggleWordWrap}
							onClick={toggleWordWrapHandler}
						/>
						<ActionBarSeparator />
						<ActionBarButton
							iconId='positron-clear-pane'
							align='right'
							tooltip={positronClearConsole}
							ariaLabel={positronClearConsole}
							onClick={clearConsoleHandler}
						/>
					</ActionBarRegion>
				</PositronActionBar>
			</div>
		</PositronActionBarContextProvider>
	);
};
