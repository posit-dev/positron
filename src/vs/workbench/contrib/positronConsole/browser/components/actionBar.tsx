/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./actionBar';
import * as React from 'react';
import { useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { localize } from 'vs/nls';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { IReactComponentContainer } from 'vs/base/browser/positronReactRenderer';
import { PositronActionBar } from 'vs/platform/positronActionBar/browser/positronActionBar';
import { ActionBarRegion } from 'vs/platform/positronActionBar/browser/components/actionBarRegion';
import { ActionBarButton } from 'vs/platform/positronActionBar/browser/components/actionBarButton';
import { ActionBarSeparator } from 'vs/platform/positronActionBar/browser/components/actionBarSeparator';
import { PositronActionBarServices } from 'vs/platform/positronActionBar/browser/positronActionBarState';
import { usePositronConsoleContext } from 'vs/workbench/contrib/positronConsole/browser/positronConsoleContext';
import { PositronActionBarContextProvider } from 'vs/platform/positronActionBar/browser/positronActionBarContext';
import { PositronConsoleState } from 'vs/workbench/services/positronConsole/common/interfaces/positronConsoleService';
import { ConsoleInstanceMenuButton } from 'vs/workbench/contrib/positronConsole/browser/components/consoleInstanceMenuButton';
import { ILanguageRuntime, RuntimeState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

// Constants.
const kPaddingLeft = 8;
const kPaddingRight = 8;

// ActionBarProps interface.
interface ActionBarProps {
	readonly reactComponentContainer: IReactComponentContainer;
}

/**
 * ActionBar component.
 * @param props An ActionBarProps that contains the component properties.
 * @returns The rendered component.
 */
export const ActionBar = (props: ActionBarProps) => {
	// Context hooks.
	const positronConsoleContext = usePositronConsoleContext();

	// State hooks.
	const [activePositronConsoleInstance, setActivePositronConsoleInstance] =
		useState(positronConsoleContext.positronConsoleService.activePositronConsoleInstance);
	const [interruptible, setInterruptible] = useState(false);
	const [interrupting, setInterrupting] = useState(false);
	const [stateLabel, setStateLabel] = useState('' as string);

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
				return;
			}

			disposableRuntimeStore.add(runtime.onDidChangeRuntimeState((state) => {
				setInterruptible(false);
				setInterrupting(false);
				setStateLabel(state);

				switch (state) {
					case RuntimeState.Busy:
						setInterruptible(true);
						break;

					case RuntimeState.Interrupting:
						setInterrupting(true);
						break;
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
		<PositronActionBarContextProvider {...positronConsoleContext as PositronActionBarServices}>
			<div className='action-bar'>
				<PositronActionBar size='small' borderTop={true} borderBottom={true} paddingLeft={kPaddingLeft} paddingRight={kPaddingRight}>
					<ActionBarRegion location='left'>
						<ConsoleInstanceMenuButton {...props} />
					</ActionBarRegion>
					<ActionBarRegion location='right'>
						<span>{stateLabel}</span>
						{interruptible &&
							<ActionBarButton
								fadeIn={true}
								disabled={interrupting}
								align='right'
								tooltip={localize('positronInterruptExeuction', "Interrupt execution")}
								onClick={interruptHandler}
							>
								<div className={`action-bar-button-icon interrupt codicon codicon-positron-interrupt-runtime`} />
							</ActionBarButton>
						}
						<ActionBarButton iconId='positron-list' align='right' tooltip={localize('positronToggleTrace', "Toggle trace")} onClick={toggleTraceHandler} />
						<ActionBarButton iconId='word-wrap' align='right' tooltip={localize('positronWordWrap', "Toggle word wrap")} onClick={toggleWordWrapHandler} />
						<ActionBarSeparator />
						<ActionBarButton iconId='positron-clear-pane' align='right' tooltip={localize('positronClearConsole', "Clear console")} onClick={clearConsoleHandler} />
					</ActionBarRegion>
				</PositronActionBar>
			</div>
		</PositronActionBarContextProvider>
	);
};
