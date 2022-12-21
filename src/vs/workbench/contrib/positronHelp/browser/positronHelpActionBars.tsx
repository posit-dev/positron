/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronHelpActionBars';
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
import { ActionBarSeparator } from 'vs/platform/positronActionBar/browser/components/actionBarSeparator';
import { PositronActionBarContextProvider } from 'vs/platform/positronActionBar/browser/positronActionBarContext';

// Constants.
const kSecondaryActionBarGap = 4;
const kPaddingLeft = 14;
const kPaddingRight = 8;
const kFindTimeout = 800;
const kPollTimeout = 200;

/**
 * PositronHelpActionBarsProps interface.
 */
export interface PositronHelpActionBarsProps {
	// Services.
	commandService: ICommandService;
	configurationService: IConfigurationService;
	contextKeyService: IContextKeyService;
	contextMenuService: IContextMenuService;
	keybindingService: IKeybindingService;
	reactComponentContainer: IReactComponentContainer;

	// Event callbacks.
	onPreviousTopic: () => void;
	onNextTopic: () => void;
	onHome: () => void;
	onFind: (findText: string) => void;
	onCheckFindResults: () => boolean | undefined;
	onFindPrevious: () => void;
	onFindNext: () => void;
	onCancelFind: () => void;
}

/**
 * PositronHelpActionBars component.
 * @param props A PositronHelpActionBarsProps that contains the component properties.
 * @returns The rendered component.
 */
export const PositronHelpActionBars = (props: PropsWithChildren<PositronHelpActionBarsProps>) => {
	// Hooks.
	const historyButtonRef = useRef<HTMLButtonElement>(undefined!);
	const [alternateFindUI, setAlternateFindUI] = useState(false);
	const [findText, setFindText] = useState('');
	const [pollFindResults, setPollFindResults] = useState(false);
	const [findResults, setFindResults] = useState(false);

	// Add IReactComponentContainer event handlers.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add the onSizeChanged event handler.
		disposableStore.add(props.reactComponentContainer.onSizeChanged(size => {
			setAlternateFindUI(size.width - kPaddingLeft - historyButtonRef.current.offsetWidth - kSecondaryActionBarGap < 180);
		}));

		// Add the onVisibilityChanged event handler.
		disposableStore.add(props.reactComponentContainer.onVisibilityChanged(visibility => {
		}));

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
					if (++counter < 30) {
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
		<div className='positron-help-action-bars'>
			<PositronActionBarContextProvider {...props}>
				<PositronActionBar size='small' paddingLeft={kPaddingLeft} paddingRight={kPaddingRight}>
					<ActionBarButton iconId='positron-left-arrow' tooltip={localize('positronPreviousTopic', "Previous topic")} onClick={() => props.onPreviousTopic()} />
					<ActionBarButton iconId='positron-right-arrow' tooltip={localize('positronNextTopic', "Next topic")} onClick={() => props.onNextTopic()} />
					<ActionBarButton iconId='positron-home' tooltip={localize('positronShowPositronHelp', "Show Positron help")} onClick={() => props.onHome()} />
					<ActionBarSeparator />
					<ActionBarButton iconId='positron-open-in-new-window' tooltip={localize('positronShowInNewWindow', "Show in new window")} />
				</PositronActionBar>
				<PositronActionBar size='small' gap={kSecondaryActionBarGap} borderBottom={!alternateFindUI} paddingLeft={kPaddingLeft} paddingRight={kPaddingRight}>
					<ActionBarButton ref={historyButtonRef} text='Home' maxTextWidth={120} dropDown={true} tooltip={localize('positronHelpHistory', "Help history")} />
					{!alternateFindUI && (
						<ActionBarFind
							width={300}
							findResults={findResults}
							initialFindText={findText}
							onFindTextChanged={setFindText}
							onFindPrevious={props.onFindPrevious}
							onFindNext={props.onFindNext} />
					)}
				</PositronActionBar>
				{alternateFindUI && (
					<PositronActionBar size='small' gap={kSecondaryActionBarGap} borderBottom={true} paddingLeft={kPaddingLeft} paddingRight={kPaddingRight}>
						<ActionBarFind
							width={300}
							findResults={findResults}
							initialFindText={findText}
							onFindTextChanged={setFindText}
							onFindPrevious={props.onFindPrevious}
							onFindNext={props.onFindNext} />
					</PositronActionBar>
				)}
			</PositronActionBarContextProvider>
		</div>
	);
};
