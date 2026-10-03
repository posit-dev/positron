/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './consoleInstanceInfoButton.css';

// React.
import { useEffect, useRef, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import * as DOM from '../../../../../base/browser/dom.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { usePositronConsoleContext } from '../positronConsoleContext.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { ActionBarButton } from '../../../../../platform/positronActionBar/browser/components/actionBarButton.js';
import { PositronModalPopup } from '../../../../browser/positronComponents/positronModalPopup/positronModalPopup.js';
import { PositronModalReactRenderer } from '../../../../../base/browser/positronModalReactRenderer.js';
import { ILanguageRuntimeSession, LanguageRuntimeSessionChannel, SessionStartReasonId } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { getRuntimeDisplayPath } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { getSessionStartReasonLabel } from '../../../../services/runtimeSession/common/sessionStartReasons.js';
import { ConfigurationTarget, IConfigurationValue } from '../../../../../platform/configuration/common/configuration.js';
import { IOpenSettingsOptions } from '../../../../services/preferences/common/preferences.js';
import { IEditorPane } from '../../../../common/editor.js';

const positronConsoleInfo = localize('positron.console.info.label', "Console Information");
const localizeShowKernelOutputChannel = (channelName: string) => localize('positron.console.info.showKernelOutputChannel', "Show {0} Output Channel", channelName);

const changeStartupBehaviorLabel = localize('positron.console.info.changeStartupBehavior', "You can change the startup behavior in settings");

const OutputChannelNames = {
	[LanguageRuntimeSessionChannel.Kernel]: localize('positron.console.info.kernel', 'Kernel'),
	[LanguageRuntimeSessionChannel.Console]: localize('positron.console.info.supervisor', 'Supervisor'),
	[LanguageRuntimeSessionChannel.LSP]: localize('positron.console.info.lsp', 'LSP')
};

function intersectionOutputChannels(availableChannels: string[]): LanguageRuntimeSessionChannel[] {
	const outputChannels = Object.values(LanguageRuntimeSessionChannel);
	return outputChannels.filter(channel => availableChannels.includes(channel));
}

export const ConsoleInstanceInfoButton = () => {
	// Hooks.
	const services = usePositronReactServicesContext();
	const positronConsoleContext = usePositronConsoleContext();

	// Reference hooks.
	const ref = useRef<HTMLButtonElement>(undefined!);

	const handlePressed = () => {
		// Get the session ID and the session. Note that we don't ask the
		// console instance for the session directly since we want this to work
		// even with a detached session.
		const sessionId =
			positronConsoleContext.activePositronConsoleInstance?.sessionId;
		if (!sessionId) {
			return;
		}
		const session = services.runtimeSessionService.getSession(sessionId);
		if (!session) {
			return;
		}

		// Open the popup immediately. The popup loads its output channels
		// asynchronously (see ConsoleInstanceInfoModalPopup) so opening it never
		// waits on the listOutputChannels() ext-host RPC, which can be slow under
		// load or early in session startup and would otherwise delay (or drop) the
		// popup entirely.
		const renderer = new PositronModalReactRenderer({
			container: services.workbenchLayoutService.getContainer(DOM.getWindow(ref.current)),
			parent: ref.current
		});

		renderer.render(
			<ConsoleInstanceInfoModalPopup
				anchorElement={ref.current}
				renderer={renderer}
				session={session}
			/>
		);
	};

	// Render.
	return (
		<ActionBarButton
			ref={ref}
			align='right'
			ariaLabel={positronConsoleInfo}
			dataTestId={`info-${positronConsoleContext.activePositronConsoleInstance?.sessionId ?? 'unknown'}`}
			icon={ThemeIcon.fromId('info')}
			tooltip={positronConsoleInfo}
			onPressed={handlePressed}
		/>
	);
};

const startupBehaviorSettingKey = 'interpreters.startupBehavior';

/**
 * Where the value of a setting that applies to a language is set.
 */
interface ISettingSource {
	/** The settings tab the value is set on. */
	readonly target: ConfigurationTarget.WORKSPACE | ConfigurationTarget.USER_REMOTE | ConfigurationTarget.USER_LOCAL;
	/** Whether the value is set for the language rather than for all languages. */
	readonly languageSpecific: boolean;
}

/**
 * Finds where the value of a setting that applies to a language is set.
 * Language-specific values win over values for all languages from any tab.
 * Among values of the same kind, workspace values win over remote user
 * values, which win over user values.
 *
 * @param value The setting inspected with the language as the override identifier.
 * @param languageSpecific Whether to assume a language-specific value when
 * no tab sets one.
 * @returns Where the value is set, or the User tab if no tab sets it.
 */
function getSettingSource(value: IConfigurationValue<string>, languageSpecific: boolean): ISettingSource {
	const tabs = [
		{ target: ConfigurationTarget.WORKSPACE, inspectValue: value.workspace },
		{ target: ConfigurationTarget.USER_REMOTE, inspectValue: value.userRemote },
		{ target: ConfigurationTarget.USER_LOCAL, inspectValue: value.userLocal },
	] as const;
	for (const override of [true, false]) {
		const tab = tabs.find(({ inspectValue }) =>
			(override ? inspectValue?.override : inspectValue?.value) !== undefined);
		if (tab) {
			return { target: tab.target, languageSpecific: override };
		}
	}
	return { target: ConfigurationTarget.USER_LOCAL, languageSpecific };
}

interface ConsoleInstanceInfoModalPopupProps {
	anchorElement: HTMLElement;
	renderer: PositronModalReactRenderer;
	session: ILanguageRuntimeSession;
}

export const ConsoleInstanceInfoModalPopup = (props: ConsoleInstanceInfoModalPopupProps) => {
	const services = usePositronReactServicesContext();
	const [sessionState, setSessionState] = useState(() => props.session.getRuntimeState());
	const [channels, setChannels] = useState<LanguageRuntimeSessionChannel[]>([]);

	// Main useEffect hook.
	useEffect(() => {
		const disposableStore = new DisposableStore();

		disposableStore.add(props.session.onDidChangeRuntimeState(state => {
			setSessionState(state);
		}));

		return () => disposableStore.dispose();
	}, [props.session]);

	// Load the session's output channels asynchronously so the popup opens
	// immediately; the channel buttons appear once listOutputChannels() resolves.
	useEffect(() => {
		let active = true;

		const loadOutputChannels = async () => {
			let available: string[];
			try {
				available = await props.session.listOutputChannels();
			} catch (err) {
				// If we fail to get the channels we can just ignore it
				console.warn('Failed to get output channels', err);
				return;
			}
			if (active) {
				setChannels(intersectionOutputChannels(available));
			}
		};

		loadOutputChannels();

		return () => { active = false; };
	}, [props.session]);

	const startReasonLabel = getSessionStartReasonLabel(props.session, services.extensionService.extensions);
	const hasStartupBehaviorLink =
		props.session.metadata.startReasonId === SessionStartReasonId.StartupBehaviorAlways ||
		props.session.metadata.startReasonId === SessionStartReasonId.StartupBehaviorAlwaysAllLanguages;

	const showKernelOutputChannelClickHandler = (channel: LanguageRuntimeSessionChannel) => {
		props.session.showOutput(channel);
		props.renderer.dispose();
	};

	const showStartupBehaviorSettingClickHandler = () => {
		// Open the settings tab the session's value comes from, so the user
		// sees the value that started the session.
		const languageId = props.session.runtimeMetadata.languageId;
		const { target, languageSpecific } = getSettingSource(
			services.configurationService.inspect<string>(startupBehaviorSettingKey, { overrideIdentifier: languageId }),
			props.session.metadata.startReasonId === SessionStartReasonId.StartupBehaviorAlways);
		// The Settings editor uses the query. The JSON settings editor
		// ignores it and uses the setting to reveal instead.
		const options: IOpenSettingsOptions = languageSpecific ?
			{ query: `@lang:${languageId} ${startupBehaviorSettingKey}`, revealSetting: { key: `[${languageId}]` } } :
			{ query: startupBehaviorSettingKey, revealSetting: { key: startupBehaviorSettingKey } };
		let opened: Promise<IEditorPane | undefined>;
		if (target === ConfigurationTarget.WORKSPACE) {
			opened = services.preferencesService.openWorkspaceSettings(options);
		} else if (target === ConfigurationTarget.USER_REMOTE) {
			opened = services.preferencesService.openRemoteSettings(options);
		} else {
			opened = services.preferencesService.openUserSettings(options);
		}
		opened.catch(err => services.logService.error(`Could not open the Startup Behavior setting: ${err}`));
		props.renderer.dispose();
	};

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
					<p className='line' data-testid='session-name'>{props.session.dynState.sessionName}</p>
					<div className='top-separator'>
						<p className='line' data-testid='session-id'>
							{localize(
								'positron.console.info.sessionId', 'Session ID: {0}',
								props.session.sessionId
							)}
						</p>
						<p className='line' data-testid='session-state'>{localize(
							'positron.console.info.state', 'State: {0}',
							sessionState)}
						</p>
						{startReasonLabel &&
							<p className='line' data-testid='session-start-reason'>
								{hasStartupBehaviorLink ?
									<>
										{localize('positron.console.info.startReasonSentence', 'Start Reason: {0}.', startReasonLabel)}
										{' '}
										<a
											className='inline-link'
											href='#'
											onClick={e => {
												e.preventDefault();
												showStartupBehaviorSettingClickHandler();
											}}
										>
											{changeStartupBehaviorLabel}
										</a>
									</> :
									localize('positron.console.info.startReason', 'Start Reason: {0}', startReasonLabel)
								}
							</p>
						}
					</div>
					<div className='top-separator'>
						<p className='line' data-testid='session-path'>{localize(
							'positron.console.info.runtimePath', 'Path: {0}',
							getRuntimeDisplayPath(props.session.runtimeMetadata))}
						</p>
						<p className='line' data-testid='session-source'>{localize(
							'positron.console.info.runtimeSource', 'Source: {0}',
							props.session.runtimeMetadata.runtimeSource)}
						</p>
					</div>
				</div>
				{channels.length > 0 &&
					<div className='top-separator actions'>
						{channels.map((channel, index) => (
							<Button
								key={`channel-${index}`}
								className='link'
								onPressed={() => showKernelOutputChannelClickHandler(channel)}
							>
								{localizeShowKernelOutputChannel(OutputChannelNames[channel])}
							</Button>
						))}
					</div>
				}
			</div>
		</PositronModalPopup>
	);
};
