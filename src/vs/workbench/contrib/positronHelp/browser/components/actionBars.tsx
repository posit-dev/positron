/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './actionBars.css';
import * as React from 'react';
import { PropsWithChildren, useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { localize } from '../../../../../nls.js';
import { IAction } from '../../../../../base/common/actions.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { IReactComponentContainer } from '../../../../../base/browser/positronReactRenderer.js';
import { PositronActionBar } from '../../../../../platform/positronActionBar/browser/positronActionBar.js';
import { ActionBarButton } from '../../../../../platform/positronActionBar/browser/components/actionBarButton.js';
import { ActionBarRegion } from '../../../../../platform/positronActionBar/browser/components/actionBarRegion.js';
import { IPositronHelpService } from '../positronHelpService.js';
import { PositronActionBarServices } from '../../../../../platform/positronActionBar/browser/positronActionBarState.js';
import { ActionBarSeparator } from '../../../../../platform/positronActionBar/browser/components/actionBarSeparator.js';
import { ActionBarMenuButton } from '../../../../../platform/positronActionBar/browser/components/actionBarMenuButton.js';
import { PositronActionBarContextProvider } from '../../../../../platform/positronActionBar/browser/positronActionBarContext.js';

// Constants.
const kSecondaryActionBarGap = 4;
const kPaddingLeft = 8;
const kPaddingRight = 8;

// Localized strings.
const tooltipPreviousTopic = localize('positronPreviousTopic', "Previous topic");
const tooltipNextTopic = localize('positronNextTopic', "Next topic");
const tooltipShowPositronHelp = localize('positronShowPositronHelp', "Show Positron help");
const tooltipHelpHistory = localize('positronHelpHistory', "Help history");

/**
 * Shortens a URL.
 * @param url The URL.
 * @returns The shortened URL.
 */
const shortenUrl = (url: string) => url.replace(new URL(url).origin, '');

/**
 * ActionBarsProps interface.
 */
export interface ActionBarsProps extends PositronActionBarServices {
	// Services.
	positronHelpService: IPositronHelpService;
	reactComponentContainer: IReactComponentContainer;

	// Event callbacks.
	onHome: () => void;
}

/**
 * ActionBars component.
 * @param props A ActionBarsProps that contains the component properties.
 * @returns The rendered component.
 */
export const ActionBars = (props: PropsWithChildren<ActionBarsProps>) => {
	// State hooks.
	const [canNavigateBackward, setCanNavigateBackward] = useState(props.positronHelpService.canNavigateBackward);
	const [canNavigateForward, setCanNavigateForward] = useState(props.positronHelpService.canNavigateForward);
	const [currentHelpEntry, setCurrentHelpEntry] = useState(props.positronHelpService.currentHelpEntry);
	const [currentHelpTitle, setCurrentHelpTitle] = useState(props.positronHelpService.currentHelpEntry?.title);

	/**
	 * Returns the help history actions.
	 * @returns The help history actions.
	 */
	const helpHistoryActions = () => {
		// Build the help history actions.
		const actions: IAction[] = [];
		const currentHelpEntry = props.positronHelpService.currentHelpEntry;
		const helpEntries = props.positronHelpService.helpEntries;
		for (let helpEntryIndex = helpEntries.length - 1; helpEntryIndex >= 0; helpEntryIndex--) {
			actions.push({
				id: generateUuid(),
				label: helpEntries[helpEntryIndex].title || shortenUrl(helpEntries[helpEntryIndex].sourceUrl),
				tooltip: '',
				class: undefined,
				enabled: true,
				checked: helpEntries[helpEntryIndex] === currentHelpEntry,
				run: () => {
					props.positronHelpService.openHelpEntryIndex(helpEntryIndex);
				}
			});
		}

		// Return the help history actions.
		return actions;
	};

	// Main useEffect.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add the onSizeChanged event handler.
		disposableStore.add(props.reactComponentContainer.onSizeChanged(size => {
			// setAlternateFindUI(size.width - kPaddingLeft - historyButtonRef.current.offsetWidth - kSecondaryActionBarGap < 180);
		}));

		// Add the onDidChangeCurrentHelpEntry event handler.
		disposableStore.add(
			props.positronHelpService.onDidChangeCurrentHelpEntry(currentHelpEntry => {
				// Set the current help entry and the current help title.
				setCurrentHelpEntry(currentHelpEntry);
				setCurrentHelpTitle(currentHelpEntry?.title);

				// Update navigation state.
				setCanNavigateBackward(props.positronHelpService.canNavigateBackward);
				setCanNavigateForward(props.positronHelpService.canNavigateForward);
			})
		);

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, []);

	// useEffect for currentHelpEntry.
	useEffect(() => {
		// If there isn't a current help entry, no further action is required.
		if (!currentHelpEntry) {
			return;
		}

		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add the onDidChangeTitle event handler.
		currentHelpEntry.onDidChangeTitle(() => {
			// Set the current help title.
			setCurrentHelpTitle(currentHelpEntry.title);
		});

		// Return the cleanup function.
		return () => disposableStore.dispose();
	}, [currentHelpEntry]);

	// Render.
	return (
		<div className='action-bars'>
			<PositronActionBarContextProvider {...props}>
				<PositronActionBar
					size='small'
					borderBottom={true}
					paddingLeft={kPaddingLeft}
					paddingRight={kPaddingRight}
				>
					<ActionBarButton
						disabled={!canNavigateBackward}
						iconId='positron-left-arrow'
						tooltip={tooltipPreviousTopic}
						ariaLabel={tooltipPreviousTopic}
						onPressed={() => props.positronHelpService.navigateBackward()}
					/>
					<ActionBarButton
						disabled={!canNavigateForward}
						iconId='positron-right-arrow'
						tooltip={tooltipNextTopic}
						ariaLabel={tooltipNextTopic}
						onPressed={() => props.positronHelpService.navigateForward()}
					/>

					<ActionBarSeparator />

					<ActionBarButton
						iconId='positron-home'
						tooltip={tooltipShowPositronHelp}
						ariaLabel={tooltipShowPositronHelp}
						disabled={true}
						onPressed={() => props.onHome()}
					/>

					{/* <ActionBarSeparator /> */}
					{/* <ActionBarButton
						iconId='positron-open-in-new-window'
						tooltip={(() => localize('positronShowInNewWindow', "Show in new window"))()}
					/> */}

				</PositronActionBar>
				<PositronActionBar
					size='small'
					gap={kSecondaryActionBarGap}
					borderBottom={true}
					paddingLeft={kPaddingLeft}
					paddingRight={kPaddingRight}
				>
					<ActionBarRegion location='left'>
						{currentHelpTitle &&
							<ActionBarMenuButton
								text={currentHelpTitle}
								tooltip={tooltipHelpHistory}
								actions={helpHistoryActions}
							/>
						}
					</ActionBarRegion>
					<ActionBarRegion location='right'>
						<ActionBarButton
							iconId='positron-search'
							tooltip={tooltipShowPositronHelp}
							ariaLabel={tooltipShowPositronHelp}
							align='right'
							disabled={currentHelpEntry === undefined}
							onPressed={() => currentHelpEntry?.showFind()}
						/>
					</ActionBarRegion>

				</PositronActionBar>
			</PositronActionBarContextProvider>
		</div>
	);
};
