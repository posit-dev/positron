/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronTopActionBar';
import * as React from 'react';
import { useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { Event } from 'vs/base/common/event';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { ILabelService } from 'vs/platform/label/common/label';
import { IHostService } from 'vs/workbench/services/host/browser/host';
import { ILayoutService } from 'vs/platform/layout/browser/layoutService';
import { IQuickInputService } from 'vs/platform/quickinput/common/quickInput';
import { IWorkspacesService } from 'vs/platform/workspaces/common/workspaces';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { PositronActionBar } from 'vs/platform/positronActionBar/browser/positronActionBar';
import { ActionBarRegion } from 'vs/platform/positronActionBar/browser/components/actionBarRegion';
import { ActionBarSeparator } from 'vs/platform/positronActionBar/browser/components/actionBarSeparator';
import { PositronActionBarServices } from 'vs/platform/positronActionBar/browser/positronActionBarState';
import { ActionBarCommandButton } from 'vs/platform/positronActionBar/browser/components/actionBarCommandButton';
import { NavigateBackwardsAction, NavigateForwardAction } from 'vs/workbench/browser/parts/editor/editorActions';
import { PositronActionBarContextProvider } from 'vs/platform/positronActionBar/browser/positronActionBarContext';
import { TopActionBarNewMenu } from 'vs/workbench/browser/parts/positronTopActionBar/components/topActionBarNewMenu';
import { TopActionBarOpenMenu } from 'vs/workbench/browser/parts/positronTopActionBar/components/topActionBarOpenMenu';
import { IPositronTopActionBarService } from 'vs/workbench/services/positronTopActionBar/browser/positronTopActionBarService';
import { TopActionBarFolderMenu } from 'vs/workbench/browser/parts/positronTopActionBar/components/topActionBarFolderMenu';
import { TopActionBarCommandCenter } from 'vs/workbench/browser/parts/positronTopActionBar/components/topActionBarCommandCenter';
import { PositronTopActionBarContextProvider } from 'vs/workbench/browser/parts/positronTopActionBar/positronTopActionBarContext';
import { TopActionBarInterpretersManager } from 'vs/workbench/browser/parts/positronTopActionBar/components/topActionBarInterpretersManager';
import { ILanguageRuntime, ILanguageRuntimeService, RuntimeState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

// Constants.
const kHorizontalPadding = 4;
const kCenterUIBreak = 600;
const kFulllCenterUIBreak = 765;

/**
 * IPositronTopActionBarContainer interface.
 */
export interface IPositronTopActionBarContainer {
	/**
	 * Gets the width.
	 */
	readonly width: number;

	/**
	 * onWidthChanged event.
	 */
	readonly onWidthChanged: Event<number>;
}

/**
 * PositronTopActionBarServices interface. Defines the set of services that are required by the Positron top action bar.
 */
export interface PositronTopActionBarServices extends PositronActionBarServices {
	hostService: IHostService;
	labelService: ILabelService;
	languageRuntimeService: ILanguageRuntimeService;
	layoutService: ILayoutService;
	positronTopActionBarService: IPositronTopActionBarService;
	quickInputService: IQuickInputService;
	workspaceContextService: IWorkspaceContextService;
	workspacesService: IWorkspacesService;
}

/**
 * PositronTopActionBarProps interface.
 */
interface PositronTopActionBarProps extends PositronTopActionBarServices {
	positronTopActionBarContainer: IPositronTopActionBarContainer;
}

/**
 * PositronTopActionBar component.
 * @param props A PositronTopActionBarProps that contains the component properties.
 * @returns The rendered component.
 */
export const PositronTopActionBar = (props: PositronTopActionBarProps) => {
	// State hooks.
	const [showCenterUI, setShowCenterUI] = useState(props.positronTopActionBarContainer.width > kCenterUIBreak);
	const [showFullCenterUI, setShowFullCenterUI] = useState(props.positronTopActionBarContainer.width > kFulllCenterUIBreak);

	// Main useEffect.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add the width changed event handler.
		disposableStore.add(props.positronTopActionBarContainer.onWidthChanged(width => {
			setShowCenterUI(width > kCenterUIBreak);
			setShowFullCenterUI(width > kFulllCenterUIBreak);
		}));

		// Return the cleanup function that will dispose of the disposables.
		return () => disposableStore.dispose();
	}, []);

	/**
	 * Shuts down runtimes for the specified language. Note that there should only ever be one
	 * running runtime per language.
	 * @param languageId The language identifier.
	 * @returns A promise that resolves when runtimes for the specified language identifier are shut
	 * down.
	 */
	const shutdownRuntimes = async (languageId: string): Promise<void> => {
		/**
		 * Gets the running runtimes for the language identifier.
		 * @returns The running runtimes for the language identifier.
		 */
		const runningRuntimes = () => props.languageRuntimeService.runningRuntimes.filter(runtime =>
			runtime.metadata.languageId === languageId
		);

		// Get the running runtimes for the language identifier.
		const runtimes = runningRuntimes();

		// If there are no running runtimes for the language identifier, return.
		if (!runtimes.length) {
			return;
		}

		// Return a promise that resolves when the running runtimes for the language identifier are
		// shutdown.
		return new Promise<void>((resolve, reject) => {
			// Shutdown the running runtimes.
			runtimes.forEach(runtime => runtime.shutdown());

			// Wait for the running runtimes to be shutdown.
			let tries = 0;
			const interval = setInterval(() => {
				if (!runningRuntimes().length) {
					clearInterval(interval);
					resolve();
				} else {
					if (++tries > 10) {
						clearInterval(interval);
						reject();
					}
				}
			}, 500);
		});
	};

	/**
	 * startRuntime event handler.
	 * @param runtimeToStart An ILanguageRuntime representing the runtime to start.
	 */
	const startRuntimeHandler = async (runtimeToStart: ILanguageRuntime): Promise<void> => {
		// Shutdown runtimes for the runtime language identifier
		await shutdownRuntimes(runtimeToStart.metadata.languageId);

		// Start the runtime.
		props.languageRuntimeService.startRuntime(runtimeToStart.metadata.runtimeId,
			`User-requested startup from the Positron top action bar`);

		// Return a promise that resolves when the runtime is started.
		return new Promise<void>((resolve, reject) => {
			// Wait for the running runtimes to be shutdown.
			let tries = 0;
			const interval = setInterval(() => {
				// See if the runtime is running.
				const runningRuntime = props.languageRuntimeService.runningRuntimes.find(
					runtime => runtime.metadata.runtimeId === runtimeToStart.metadata.runtimeId
				);

				// If the runtime is running, resolve the promise; otherwise, if we have waited too
				// long, reject the promise.
				if (runningRuntime) {
					clearInterval(interval);
					resolve();
				} else {
					if (++tries > 10) {
						clearInterval(interval);
						reject();
					}
				}
			}, 500);
		});
	};

	/**
	 * activateRuntime event handler.
	 * @param runtime An ILanguageRuntime representing the runtime to activate.
	 */
	const activateRuntimeHandler = async (runtime: ILanguageRuntime): Promise<void> => {
		// Determine which action to take.
		switch (runtime.getRuntimeState()) {
			// When the runtime is uninitialized or exited, start it.
			case RuntimeState.Uninitialized:
			case RuntimeState.Exited:
				await startRuntimeHandler(runtime);
				break;

			// When the runtime is in other states, make it the active runtime.
			default:
				props.languageRuntimeService.activeRuntime = runtime;
				break;
		}
	};

	// Render.
	return (
		<PositronTopActionBarContextProvider {...props}>
			<PositronActionBarContextProvider {...props}>

				<PositronActionBar size='large' borderBottom={true} paddingLeft={kHorizontalPadding} paddingRight={kHorizontalPadding}>

					<ActionBarRegion location='left'>
						<TopActionBarNewMenu />
						<ActionBarSeparator />
						<TopActionBarOpenMenu />
						<ActionBarSeparator />
						<ActionBarCommandButton iconId='positron-save' commandId={'workbench.action.files.save'} />
						<ActionBarCommandButton iconId='positron-save-all' commandId={'workbench.action.files.saveFiles'} />
					</ActionBarRegion>

					{showCenterUI && (
						<ActionBarRegion location='center'>

							<PositronActionBar size='large' nestedActionBar={true}>
								{showFullCenterUI && (
									<ActionBarRegion width={60} location='left' justify='right'>
										<ActionBarCommandButton iconId='chevron-left' commandId={NavigateBackwardsAction.ID} />
										<ActionBarCommandButton iconId='chevron-right' commandId={NavigateForwardAction.ID} />
									</ActionBarRegion>
								)}
								<ActionBarRegion location='center'>
									<TopActionBarCommandCenter />
								</ActionBarRegion>
								{showFullCenterUI && (
									<ActionBarRegion width={60} location='right' justify='left' />
								)}
							</PositronActionBar>

						</ActionBarRegion>
					)}

					<ActionBarRegion location='right'>
						<TopActionBarInterpretersManager
							onStartRuntime={startRuntimeHandler}
							onActivateRuntime={activateRuntimeHandler}
						/>
						{showCenterUI && (
							<TopActionBarFolderMenu />
						)}
					</ActionBarRegion>

				</PositronActionBar>

			</PositronActionBarContextProvider>
		</PositronTopActionBarContextProvider>
	);
};
