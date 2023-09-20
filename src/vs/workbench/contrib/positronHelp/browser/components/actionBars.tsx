/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./actionBars';
import * as React from 'react';
import { PropsWithChildren, useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { localize } from 'vs/nls';
import { IAction } from 'vs/base/common/actions';
import { generateUuid } from 'vs/base/common/uuid';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IReactComponentContainer } from 'vs/base/browser/positronReactRenderer';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { PositronActionBar } from 'vs/platform/positronActionBar/browser/positronActionBar';
// import { ActionBarFind } from 'vs/platform/positronActionBar/browser/components/actionBarFind';
import { ActionBarButton } from 'vs/platform/positronActionBar/browser/components/actionBarButton';
import { ActionBarRegion } from 'vs/platform/positronActionBar/browser/components/actionBarRegion';
import { IPositronHelpService } from 'vs/workbench/contrib/positronHelp/browser/positronHelpService';
import { ActionBarSeparator } from 'vs/platform/positronActionBar/browser/components/actionBarSeparator';
import { ActionBarMenuButton } from 'vs/platform/positronActionBar/browser/components/actionBarMenuButton';
import { PositronActionBarContextProvider } from 'vs/platform/positronActionBar/browser/positronActionBarContext';

// Constants.
const kSecondaryActionBarGap = 4;
const kPaddingLeft = 8;
const kPaddingRight = 8;
const kFindTimeout = 800;
const kPollTimeout = 200;

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
export interface ActionBarsProps {
	// Services.
	commandService: ICommandService;
	configurationService: IConfigurationService;
	contextKeyService: IContextKeyService;
	contextMenuService: IContextMenuService;
	keybindingService: IKeybindingService;
	positronHelpService: IPositronHelpService;
	reactComponentContainer: IReactComponentContainer;

	// Event callbacks.
	onHome: () => void;

	onFind: (findText: string) => void;
	onCheckFindResults: () => boolean | undefined;
	onFindPrevious: () => void;
	onFindNext: () => void;
	onCancelFind: () => void;
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

	// Find stuff. Placeholder.
	const [findText, _setFindText] = useState('');
	const [pollFindResults, setPollFindResults] = useState(false);
	const [_findResults, setFindResults] = useState(false);

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

	// Find text effect.
	useEffect(() => {
		if (findText === '') {
			setFindResults(false);
			return props.onCancelFind();
		} else {
			// Start the find timeout.
			const timeout = setTimeout(() => {
				setFindResults(false);
				props.onFind(findText);
				setPollFindResults(true);
			}, kFindTimeout);

			// Return the cleanup.
			return () => clearTimeout(timeout);
		}
	}, [findText]);

	// Poll find results effect.
	useEffect(() => {
		if (!pollFindResults) {
			return;
		} else {
			// Start the poll find results interval.
			let counter = 0;
			const interval = setInterval(() => {
				const checkFindResults = props.onCheckFindResults();
				console.log(`Poll for find results was ${checkFindResults}`);
				if (checkFindResults === undefined) {
					if (++counter < 5) {
						return;
					}
				} else {
					setFindResults(checkFindResults);
				}

				// Clear poll find results.
				setPollFindResults(false);
			}, kPollTimeout);

			// Return the cleanup.
			return () => clearInterval(interval);
		}
	}, [pollFindResults]);

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
						onClick={() => props.positronHelpService.navigateBackward()}
					/>
					<ActionBarButton
						disabled={!canNavigateForward}
						iconId='positron-right-arrow'
						tooltip={tooltipNextTopic}
						onClick={() => props.positronHelpService.navigateForward()}
					/>

					<ActionBarSeparator />

					<ActionBarButton
						iconId='positron-home'
						tooltip={tooltipShowPositronHelp}
						disabled={true}
						onClick={() => props.onHome()}
					/>

					{/* <ActionBarSeparator /> */}
					{/* <ActionBarButton
						iconId='positron-open-in-new-window'
						tooltip={localize('positronShowInNewWindow', "Show in new window")}
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
							align='right'
							disabled={currentHelpEntry === undefined}
							onClick={() => currentHelpEntry?.showFind()}
						/>

						{/* <ActionBarFind
							width={175}
							findResults={findResults}
							initialFindText={findText}
							onFindTextChanged={setFindText}
							onFindPrevious={props.onFindPrevious}
							onFindNext={props.onFindNext} /> */}
					</ActionBarRegion>

				</PositronActionBar>

				{/* {false && alternateFindUI && (
					<PositronActionBar
						size='small'
						gap={kSecondaryActionBarGap}
						borderBottom={true}
						paddingLeft={kPaddingLeft}
						paddingRight={kPaddingRight}
					>
						<ActionBarFind
							width={300}
							findResults={findResults}
							initialFindText={findText}
							onFindTextChanged={setFindText}
							onFindPrevious={props.onFindPrevious}
							onFindNext={props.onFindNext} />
					</PositronActionBar>
				)} */}
			</PositronActionBarContextProvider>
		</div>
	);
};
