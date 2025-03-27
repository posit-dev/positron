/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './consoleInstanceInfoButton.css';

// React.
import React, { useEffect, useRef, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import * as DOM from '../../../../../base/browser/dom.js';
import { PositronModalPopup } from '../../../../browser/positronComponents/positronModalPopup/positronModalPopup.js'
import { ActionBarButton } from '../../../../../platform/positronActionBar/browser/components/actionBarButton.js';
import { PositronModalReactRenderer } from '../../../../browser/positronModalReactRenderer/positronModalReactRenderer.js';
import { usePositronConsoleContext } from '../positronConsoleContext.js';
import { PositronButton } from '../../../../../base/browser/ui/positronComponents/button/positronButton.js';
import { ILanguageRuntimeSession, LanguageRuntimeSessionChannel } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';

const positronConsoleInfo = localize('positron.console.info.label', "Console information");
const localizeShowKernelOutputChannel = (channelName: string) => localize('positron.console.info.showKernelOutputChannel', "Show {0} Output Channel", channelName);

const OutputChannelNames = {
	[LanguageRuntimeSessionChannel.Kernel]: localize('positron.console.info.kernel', 'Kernel'),
	[LanguageRuntimeSessionChannel.Console]: localize('positron.console.info.console', 'Console'),
	[LanguageRuntimeSessionChannel.LSP]: localize('positron.console.info.lsp', 'LSP')
};

function intersectionOutputChannels(availableChannels: string[]): LanguageRuntimeSessionChannel[] {
	const outputChannels = Object.values(LanguageRuntimeSessionChannel);
	return outputChannels.filter(channel => availableChannels.includes(channel));
}

export const ConsoleInstanceInfoButton = () => {
	// Hooks.
	const positronConsoleContext = usePositronConsoleContext();

	// Reference hooks.
	const ref = useRef<HTMLButtonElement>(undefined!);

	const handlePressed = async () => {
		// Get the session ID and the session. Note that we don't ask the
		// console instance for the session directly since we want this to work
		// even with a detached session.
		const sessionId =
			positronConsoleContext.activePositronConsoleInstance?.sessionId;
		if (!sessionId) {
			return;
		}
		const session = positronConsoleContext.runtimeSessionService.getSession(sessionId);
		if (!session) {
			return;
		}

		// Get the channels from the session.
		let channels: LanguageRuntimeSessionChannel[] = []
		try {
			channels = intersectionOutputChannels(await session.listOutputChannels());
		} catch (err) {
			// If we fail to get the channels we can just ignore it
			console.warn('Failed to get output channels', err);
		}

		// Create the renderer.
		const renderer = new PositronModalReactRenderer({
			keybindingService: positronConsoleContext.keybindingService,
			layoutService: positronConsoleContext.layoutService,
			container: positronConsoleContext.layoutService.getContainer(DOM.getWindow(ref.current)),
			parent: ref.current
		});

		renderer.render(
			<ConsoleInstanceInfoModalPopup
				anchorElement={ref.current}
				channels={channels}
				renderer={renderer}
				session={session}
			/>
		);
	}

	// Render.
	return (
		<ActionBarButton
			ref={ref}
			align='right'
			ariaLabel={positronConsoleInfo}
			dataTestId={`info-${positronConsoleContext.activePositronConsoleInstance?.sessionId ?? 'unknown'}`}
			iconId='info'
			tooltip={positronConsoleInfo}
			onPressed={handlePressed}
		/>
	)
};

interface ConsoleInstanceInfoModalPopupProps {
	anchorElement: HTMLElement;
	renderer: PositronModalReactRenderer;
	session: ILanguageRuntimeSession;
	channels: LanguageRuntimeSessionChannel[];
}

const ConsoleInstanceInfoModalPopup = (props: ConsoleInstanceInfoModalPopupProps) => {
	const [sessionState, setSessionState] = useState(() => props.session.getRuntimeState());

	// Main useEffect hook.
	useEffect(() => {
		const disposableStore = new DisposableStore();

		disposableStore.add(props.session.onDidChangeRuntimeState(state => {
			setSessionState(state);
		}));

		return () => disposableStore.dispose();
	}, [props.session, props.renderer]);

	const showKernelOutputChannelClickHandler = (channel: LanguageRuntimeSessionChannel) => {
		props.session.showOutput(channel);
		props.renderer.dispose();
	}

	// Render.
	return (
		<PositronModalPopup
			anchorElement={props.anchorElement}
			fixedHeight={true}
			height='auto'
			keyboardNavigationStyle='menu'
			popupAlignment='auto'
			popupPosition='auto'
			renderer={props.renderer}
			width={400}
		>
			<div className='console-instance-info'>
				<div className='content'>
					<p className='line' data-testid='session-name'>{props.session.metadata.sessionName}</p>
					<div className='top-separator'>
						<p className='line' data-testid='session-id'>
							{(() => localize(
								'positron.console.info.sessionId', 'Session ID: {0}',
								props.session.sessionId
							))()}
						</p>
						<p className='line' data-testid='session-state'>{(() => localize(
							'positron.console.info.state', 'State: {0}',
							sessionState))()}
						</p>
					</div>
					<div className='top-separator'>
						<p className='line' data-testid='session-path'>{(() => localize(
							'positron.console.info.runtimePath', 'Path: {0}',
							props.session.runtimeMetadata.runtimePath))()}
						</p>
						<p className='line' data-testid='session-source'>{(() => localize(
							'positron.console.info.runtimeSource', 'Source: {0}',
							props.session.runtimeMetadata.runtimeSource))()}
						</p>
					</div>
				</div>
				<div className='top-separator actions'>
					{props.channels.map((channel, index) => (
						<PositronButton
							key={`channel-${index}`}
							className='link'
							onPressed={() => showKernelOutputChannelClickHandler(channel)}
						>
							{localizeShowKernelOutputChannel(OutputChannelNames[channel])}
						</PositronButton>
					))}
				</div>
			</div>
		</PositronModalPopup>
	)
};
