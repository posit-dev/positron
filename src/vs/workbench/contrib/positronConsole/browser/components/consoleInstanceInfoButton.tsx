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

	const handlePressed = () => {
		if (!positronConsoleContext.activePositronConsoleInstance) {
			return;
		}

		// Create the renderer.
		const renderer = new PositronModalReactRenderer({
			keybindingService: positronConsoleContext.keybindingService,
			layoutService: positronConsoleContext.workbenchLayoutService,
			container: positronConsoleContext.workbenchLayoutService.getContainer(DOM.getWindow(ref.current)),
			parent: ref.current
		});

		renderer.render(
			<ConsoleInstanceInfoModalPopup
				anchorElement={ref.current}
				renderer={renderer}
				session={positronConsoleContext.activePositronConsoleInstance.session}
			/>
		);
	}

	// Render.
	return (
		<ActionBarButton
			iconId='info'
			align='right'
			tooltip={positronConsoleInfo}
			ariaLabel={positronConsoleInfo}
			onPressed={handlePressed}
			ref={ref}
		/>
	)
};

interface ConsoleInstanceInfoModalPopupProps {
	anchorElement: HTMLElement;
	renderer: PositronModalReactRenderer;
	session: ILanguageRuntimeSession;
}

const ConsoleInstanceInfoModalPopup = (props: ConsoleInstanceInfoModalPopupProps) => {
	const [sessionState, setSessionState] = useState(() => props.session.getRuntimeState());
	const [availableChannels, setAvailableChannels] = useState<LanguageRuntimeSessionChannel[]>([]);

	// Main useEffect hook.
	useEffect(() => {
		const disposableStore = new DisposableStore();
		disposableStore.add(props.session.onDidChangeRuntimeState(state => {
			setSessionState(state);
		}));

		// Fetch available channels.
		props.session.listOutputChannels().then(availableChannels => {
			const channels = intersectionOutputChannels(availableChannels);
			setAvailableChannels(channels);
		});

		return () => disposableStore.dispose();
	}, [props.session, props.renderer]);

	const showKernelOutputChannelClickHandler = (channel: LanguageRuntimeSessionChannel) => {
		props.session.showOutput(channel);
	}

	// Render.
	return (
		<PositronModalPopup
			anchorElement={props.anchorElement}
			height='min-content'
			keyboardNavigationStyle='menu'
			popupAlignment='auto'
			popupPosition='auto'
			renderer={props.renderer}
			width={400}
		>
			<div className='console-instance-info'>
				<div className='content'>
					<p className='line'>{props.session.metadata.sessionName}</p>
					<div className='top-separator'>
						<p className='line'>
							{(() => localize(
								'positron.console.info.sessionId', 'Session ID: {0}',
								props.session.sessionId
							))()}
						</p>
						<p className='line'>{(() => localize(
							'positron.console.info.state', 'State: {0}',
							sessionState))()}
						</p>
					</div>
					<div className='top-separator'>
						<p className='line'>{(() => localize(
							'positron.console.info.runtimePath', 'Path: {0}',
							props.session.runtimeMetadata.runtimePath))()}
						</p>
						<p className='line'>{(() => localize(
							'positron.console.info.runtimeSource', 'Source: {0}',
							props.session.runtimeMetadata.runtimeSource))()}
						</p>
					</div>
				</div>
				<div className='top-separator actions'>
					{availableChannels.map(channel => (
						<PositronButton className='link' onPressed={() => showKernelOutputChannelClickHandler(channel)}>
							{localizeShowKernelOutputChannel(OutputChannelNames[channel])}
						</PositronButton>
					))}
				</div>
			</div>
		</PositronModalPopup>
	)
};
