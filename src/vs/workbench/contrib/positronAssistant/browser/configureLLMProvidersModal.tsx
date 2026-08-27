/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './configureLLMProvidersModal.css';

// React.
import { useState } from 'react';

// Other dependencies.
import { localize } from '../../../../nls.js';
import { IPositronLanguageModelConfig, IPositronLanguageModelSource, IShowLanguageModelConfigOptions } from '../common/interfaces/positronAssistantService.js';
import { PositronDynamicModalDialog } from '../../../browser/positronComponents/positronDynamicModalDialog/positronDynamicModalDialog.js';
import { PositronModalReactRenderer } from '../../../../base/browser/positronModalReactRenderer.js';
import { ProviderList } from './components/providerList.js';
import { ConnectProviderView } from './components/connectProviderView.js';
import { ConnectedProviderView } from './components/connectedProviderView.js';
import { selectProviderView } from './providerConnection.js';
import { useProviderUpdates } from './useProviderUpdates.js';
import { usePositronReactServicesContext } from '../../../../base/browser/positronReactRendererContext.js';

/** Command that opens providers.json in an editor (registered in the contribution). */
const OPEN_PROVIDERS_JSON_COMMAND = 'workbench.action.positronAssistant.openAiProviderSettingsJson';

/** The width every view's dialog box is drawn at. */
const MODAL_WIDTH = 600;

/**
 * How tall the provider list grows before it scrolls: a section heading plus
 * seven rows, at 52px a row with a 4px gap (20 + 4 + 7 * 52 + 6 * 4). Adding the
 * title bar, the footer and the content padding puts the dialog a little over
 * 500px, which clears the gutters on a 640px-tall window. The box already stops
 * at the window height less its gutters, so this is not what keeps it on screen;
 * it stops a long list from stretching the box to fill a tall one. There is no
 * minimum: a short list shrinks the box, as it does on the connect and connected
 * views.
 */
const LIST_CONTENT_MAX_HEIGHT = 412;

type OnAction = (source: IPositronLanguageModelSource, config: IPositronLanguageModelConfig, action: string) => Promise<void>;

/**
 * Where the connect view leaves a way to cancel an OAuth sign-in that is still
 * running. This is a plain object rather than React state because the renderer's
 * teardown has to read it after the component has unmounted.
 */
export interface PendingSignIn {
	cancel?: () => void;
}

export const showConfigureLLMProvidersModal = (
	sources: IPositronLanguageModelSource[],
	onAction: OnAction,
	onClose: () => void,
	options?: IShowLanguageModelConfigOptions,
) => {
	const renderer = new PositronModalReactRenderer({
		onDisposed: () => {
			onClose();
		},
	});
	renderer.render(
		<div className='configure-llm-providers-modal' data-testid='configure-llm-providers-modal'>
			<ConfigureLLMProviders
				preselectedProviderId={options?.preselectedProviderId}
				renderer={renderer}
				sources={sources}
				onAction={onAction}
			/>
		</div>
	);
};

export interface ConfigureLLMProvidersProps {
	renderer: PositronModalReactRenderer;
	sources: IPositronLanguageModelSource[];
	/** Provider to open on, skipping the list. Ignored if it is not in `sources`. */
	preselectedProviderId?: string;
	onAction: OnAction;
}

export const ConfigureLLMProviders = (props: ConfigureLLMProvidersProps) => {
	const services = usePositronReactServicesContext();

	// The caller can name a provider to open on -- the "Configure" button on a
	// provider error notification does, so the user lands on the provider that
	// reported the problem rather than hunting for it in the list.
	const preselectedSource = props.sources.find(s => s.provider.id === props.preselectedProviderId);
	const [view, setView] = useState<'list' | 'connect' | 'connected'>(
		preselectedSource ? selectProviderView(preselectedSource) : 'list'
	);
	const [selectedProviderId, setSelectedProviderId] = useState<string | undefined>(preselectedSource?.provider.id);

	// Live copy of the provider sources. The modal outlives every view, so this
	// single subscription can never miss an update, and the child views can stay
	// presentational and unmount freely. Sources are shallow-cloned on change
	// because updateProvider mutates the registered source in place.
	const [sources, setSources] = useState<IPositronLanguageModelSource[]>(props.sources);

	// Route view changes driven by live sign-in state for the selected provider:
	// the connect view advances to connected on sign-in; the connected view
	// returns to the list on sign-out.
	const applySignedInTransition = (providerId: string, signedIn: boolean) => {
		if (providerId !== selectedProviderId) {
			return;
		}
		if (view === 'connect' && signedIn) {
			setView('connected');
		} else if (view === 'connected' && !signedIn) {
			setView('list');
		}
	};

	useProviderUpdates(
		props.sources.map(s => s.provider.id),
		newSource => {
			setSources(prev => prev.map(s => s.provider.id === newSource.provider.id ? { ...newSource } : s));
			applySignedInTransition(newSource.provider.id, !!newSource.signedIn);
		},
		(providerId, signedIn) => {
			setSources(prev => prev.map(s => s.provider.id === providerId ? { ...s, signedIn } : s));
			applySignedInTransition(providerId, signedIn);
		},
	);

	// The selected provider, always read from the fresh sources. Defensive: if it
	// ever cannot be resolved while on a detail view, fall back to the list.
	const selectedSource = sources.find(s => s.provider.id === selectedProviderId);
	const activeView = (view === 'connect' || view === 'connected') && !selectedSource ? 'list' : view;

	// Disposing runs the teardown the show function installed, which cancels an
	// in-flight sign-in and reports the modal closed.
	const close = () => {
		props.renderer.dispose();
	};

	// Open providers.json for advanced editing, then close the modal so the editor
	// is visible. This discards unsaved form input, which the link's label calls out.
	const editRawConfig = () => {
		services.commandService.executeCommand(OPEN_PROVIDERS_JSON_COMMAND);
		close();
	};

	const backToList = () => {
		setView('list');
	};

	const title = activeView === 'list' || !selectedSource
		? localize('positron.configureLLMProvidersModal.title', "Configure LLM Providers")
		: activeView === 'connect'
			? localize('positron.configureLLMProvidersModal.connectTitle', "Connect to {0}", selectedSource.provider.displayName)
			: selectedSource.provider.displayName;

	return (
		<>
			{activeView === 'list' &&
				<PositronDynamicModalDialog
					content={
						<ProviderList
							sources={sources}
							onSelectProvider={source => { setSelectedProviderId(source.provider.id); setView(selectProviderView(source)); }}
						/>
					}
					contentMaxHeight={LIST_CONTENT_MAX_HEIGHT}
					renderer={props.renderer}
					title={title}
					width={MODAL_WIDTH}
					onCancel={close}
				/>
			}
			{activeView === 'connect' && selectedSource &&
				<ConnectProviderView
					renderer={props.renderer}
					source={selectedSource}
					title={title}
					width={MODAL_WIDTH}
					onAction={props.onAction}
					onBack={backToList}
					onEditRawConfig={editRawConfig}
				/>
			}
			{activeView === 'connected' && selectedSource &&
				<ConnectedProviderView
					renderer={props.renderer}
					source={selectedSource}
					title={title}
					width={MODAL_WIDTH}
					onAction={props.onAction}
					onBack={backToList}
				/>
			}
		</>
	);
};
