/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./actionBars';
import * as React from 'react';
import { PropsWithChildren, useEffect, useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { localize } from 'vs/nls';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IReactComponentContainer } from 'vs/base/browser/positronReactRenderer';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { PositronActionBar } from 'vs/platform/positronActionBar/browser/positronActionBar';
import { ActionBarFind } from 'vs/platform/positronActionBar/browser/components/actionBarFind';
import { ActionBarButton } from 'vs/platform/positronActionBar/browser/components/actionBarButton';
import { ActionBarRegion } from 'vs/platform/positronActionBar/browser/components/actionBarRegion';
import { ActionBarSeparator } from 'vs/platform/positronActionBar/browser/components/actionBarSeparator';
import { IPositronHelpService } from 'vs/workbench/services/positronHelp/common/interfaces/positronHelpService';
import { PositronActionBarContextProvider } from 'vs/platform/positronActionBar/browser/positronActionBarContext';
import { useStateRef } from 'vs/base/browser/ui/react/useStateRef';

// Constants.
const kSecondaryActionBarGap = 4;
const kPaddingLeft = 8;
const kPaddingRight = 8;
const kFindTimeout = 800;
const kPollTimeout = 200;

//
const previousTopic = localize('positronPreviousTopic', "Previous topic");
const nextTopic = localize('positronNextTopic', "Next topic");

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
	// Reference hooks.
	const historyButtonRef = useRef<HTMLDivElement>(undefined!);

	// State hooks.
	const [canNavigateBackward, setCanNavigateBackward] = useState(props.positronHelpService.canNavigateBackward);
	const [canNavigateForward, setCanNavigateForward] = useState(props.positronHelpService.canNavigateForward);
	const [helpTitle, setHelpTitle] = useState<string | undefined>(undefined);
	const [, setTitleTimeout, titleTimeoutRef] = useStateRef<NodeJS.Timeout | undefined>(undefined);

	const [findText, setFindText] = useState('');
	const [pollFindResults, setPollFindResults] = useState(false);
	const [findResults, setFindResults] = useState(false);

	// Main useEffect.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add the onSizeChanged event handler.
		disposableStore.add(
			props.reactComponentContainer.onSizeChanged(size => {
				// setAlternateFindUI(size.width - kPaddingLeft - historyButtonRef.current.offsetWidth - kSecondaryActionBarGap < 180);
			})
		);

		// Add the onDidChangeCurrentHelpEntry event handler.
		disposableStore.add(
			props.positronHelpService.onDidChangeCurrentHelpEntry(currentHelpEntry => {
				// Set the help title.
				setHelpTitle(currentHelpEntry?.title);

				// If a help entry was loaded, set a timeout for one second from now. If it fires,
				// set the title to be the help URL. We do this because there's no guarantee that
				// the help document will actually load.
				if (currentHelpEntry) {
					setTitleTimeout(setTimeout(() => {
						const helpURL = new URL(currentHelpEntry.sourceUrl);
						setHelpTitle(helpURL.href.replace(helpURL.origin, ''));
					}, 1000));
				}

				// Update navigation state.
				setCanNavigateBackward(props.positronHelpService.canNavigateBackward);
				setCanNavigateForward(props.positronHelpService.canNavigateForward);
			})
		);

		// Add the onHelpLoaded event handler. This is fired when our embedded script in the help
		// document detects that the document has loaded. This is not guaranteed to happen, though
		// it always does.
		disposableStore.add(
			props.positronHelpService.onHelpLoaded(helpEntry => {
				// Clear the title timeout, if needed.
				if (titleTimeoutRef.current) {
					clearTimeout(titleTimeoutRef.current);
				}

				// Set the title.
				if (helpEntry.title) {
					setHelpTitle(helpEntry?.title);
				} else {
					const helpURL = new URL(helpEntry.sourceUrl);
					setHelpTitle(helpURL.href.replace(helpURL.origin, ''));
				}
			})
		);

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, []);

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
						tooltip={previousTopic}
						onClick={() => props.positronHelpService.navigateBackward()}
					/>
					<ActionBarButton
						disabled={!canNavigateForward}
						iconId='positron-right-arrow'
						tooltip={nextTopic}
						onClick={() => props.positronHelpService.navigateForward()}
					/>

					<ActionBarSeparator />

					<ActionBarButton
						iconId='positron-home'
						tooltip={localize('positronShowPositronHelp', "Show Positron help")}
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
						{helpTitle &&
							<ActionBarButton
								ref={historyButtonRef}
								text={helpTitle}
								dropDown={false}
								tooltip={helpTitle || localize('positronHelpHistory', "Help history")}
							/>
						}
					</ActionBarRegion>
					<ActionBarRegion location='right'>
						<ActionBarFind
							width={175}
							findResults={findResults}
							initialFindText={findText}
							onFindTextChanged={setFindText}
							onFindPrevious={props.onFindPrevious}
							onFindNext={props.onFindNext} />
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
