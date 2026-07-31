/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './configureLLMProvidersModal.css';

// React.
import { useCallback, useRef, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../nls.js';
import { IPositronLanguageModelConfig, IPositronLanguageModelSource, IShowLanguageModelConfigOptions, PositronLanguageModelType } from '../common/interfaces/positronAssistantService.js';
import { PositronModalDialog } from '../../../browser/positronComponents/positronModalDialog/positronModalDialog.js';
import { ContentArea } from '../../../browser/positronComponents/positronModalDialog/components/contentArea.js';
import { PositronModalReactRenderer } from '../../../../base/browser/positronModalReactRenderer.js';
import { ProviderList } from './components/providerList.js';
import { ConnectProviderView } from './components/connectProviderView.js';
import { ConnectedProviderView } from './components/connectedProviderView.js';
import { NotYetSupportedView } from './components/notYetSupportedView.js';
import { ProviderModalFooter } from './components/providerModalFooter.js';
import { selectProviderView } from './providerConnection.js';
import { useProviderUpdates } from './useProviderUpdates.js';
import { usePositronReactServicesContext } from '../../../../base/browser/positronReactRendererContext.js';

/** Command that opens providers.json in an editor (registered in the contribution). */
const OPEN_PROVIDERS_JSON_COMMAND = 'workbench.action.positronAssistant.openAiProviderSettingsJson';

type OnAction = (source: IPositronLanguageModelSource, config: IPositronLanguageModelConfig, action: string) => Promise<void>;

/**
 * Hidden feature switch that selects the new "Configure LLM Providers" modal
 * over the legacy language model provider dialog.
 *
 * This key is intentionally NOT contributed to the configuration registry, so
 * it does not appear in the Settings editor. Set it manually in `settings.json`
 * to opt in to the in-progress modal. It defaults to `false` (legacy dialog).
 */
export const NEW_PROVIDER_MODAL_KEY = 'assistant.newProviderModal';

/**
 * Provider id of the custom (OpenAI-compatible) provider. The authentication
 * extension registers a `providerAction` for it unconditionally, so dispatching
 * `save` to this id persists even before the provider is enabled.
 */
const CUSTOM_PROVIDER_ID = 'openai-compatible';

/**
 * Source used for the "Add custom provider" flow when the provider is not yet
 * enabled (so absent from the registered, enabled-only source list). It carries
 * the real provider id so `save` reaches the authentication extension's provider
 * action. When the provider is already enabled, the real registered source is
 * used instead (picking up its saved base URL etc.).
 */
const CUSTOM_PROVIDER_FALLBACK_SOURCE: IPositronLanguageModelSource = {
	type: PositronLanguageModelType.Chat,
	provider: {
		id: CUSTOM_PROVIDER_ID,
		displayName: localize('positron.configureLLMProvidersModal.customProviderName', "Custom Provider"),
	},
	supportedOptions: ['apiKey', 'baseUrl', 'toolCalls', 'protocol', 'customModels'],
	defaults: { protocol: 'openai-chat' },
};

export const showConfigureLLMProvidersModal = (
	sources: IPositronLanguageModelSource[],
	onAction: OnAction,
	onClose: () => void,
	_options?: IShowLanguageModelConfigOptions,
) => {
	const renderer = new PositronModalReactRenderer();
	renderer.render(
		<div className='configure-llm-providers-modal'>
			<ConfigureLLMProviders renderer={renderer} sources={sources} onAction={onAction} onClose={onClose} />
		</div>
	);
};

export interface ConfigureLLMProvidersProps {
	renderer: PositronModalReactRenderer;
	sources: IPositronLanguageModelSource[];
	onAction: OnAction;
	onClose: () => void;
}

export const ConfigureLLMProviders = (props: ConfigureLLMProvidersProps) => {
	const services = usePositronReactServicesContext();
	const [view, setView] = useState<'list' | 'connect' | 'connected' | 'notSupported'>('list');
	const [selectedProviderId, setSelectedProviderId] = useState<string>();

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

	// The selected provider, always read from the fresh sources. The custom
	// provider falls back to a synthetic source when it is not yet enabled (so
	// not in the list). Defensive otherwise: an unresolved detail view drops to
	// the list.
	const selectedSource = sources.find(s => s.provider.id === selectedProviderId)
		?? (selectedProviderId === CUSTOM_PROVIDER_ID ? CUSTOM_PROVIDER_FALLBACK_SOURCE : undefined);
	const activeView = (view === 'connect' || view === 'connected') && !selectedSource ? 'list' : view;

	// A cancel handler reported by the connect view while an OAuth sign-in is in
	// flight. Held in a ref (read only at close time) so it does not re-render the
	// modal as the sign-in progresses.
	const pendingCancelRef = useRef<(() => void) | undefined>(undefined);
	const setPendingCancel = useCallback((cancel: (() => void) | undefined) => {
		pendingCancelRef.current = cancel;
	}, []);

	const close = () => {
		// Closing (footer Close, Esc, or backdrop) during an in-flight OAuth sign-in
		// cancels it so the device flow is not left running after the modal is gone.
		pendingCancelRef.current?.();
		props.onClose();
		props.renderer.dispose();
	};

	// Open providers.json for advanced editing, then close the modal so the editor
	// is visible. This discards unsaved form input, which the link's label calls out.
	const editRawConfig = () => {
		services.commandService.executeCommand(OPEN_PROVIDERS_JSON_COMMAND);
		close();
	};

	const title = activeView === 'list' || !selectedSource
		? localize('positron.configureLLMProvidersModal.title', "Configure LLM Providers")
		: activeView === 'connect'
			? localize('positron.configureLLMProvidersModal.connectTitle', "Connect to {0}", selectedSource.provider.displayName)
			: selectedSource.provider.displayName;

	return (
		<PositronModalDialog
			height={500}
			renderer={props.renderer}
			title={title}
			width={600}
			onCancel={close}
		>
			{activeView === 'list' &&
				<>
					<ContentArea>
						<ProviderList
							sources={sources}
							onAddCustomProvider={() => { setSelectedProviderId(CUSTOM_PROVIDER_ID); setView('connect'); }}
							onSelectProvider={source => { setSelectedProviderId(source.provider.id); setView(selectProviderView(source)); }}
						/>
					</ContentArea>
					<ProviderModalFooter onClose={close} />
				</>
			}
			{activeView === 'connect' && selectedSource &&
				<ConnectProviderView
					source={selectedSource}
					onAction={props.onAction}
					onBack={() => setView('list')}
					onClose={close}
					onEditRawConfig={editRawConfig}
					onPendingSignInChange={setPendingCancel}
				/>
			}
			{activeView === 'connected' && selectedSource &&
				<ConnectedProviderView
					source={selectedSource}
					onAction={props.onAction}
					onBack={() => setView('list')}
					onClose={close}
				/>
			}
			{activeView === 'notSupported' &&
				<>
					<ContentArea>
						<NotYetSupportedView source={selectedSource} />
					</ContentArea>
					<ProviderModalFooter onBack={() => setView('list')} onClose={close} />
				</>
			}
		</PositronModalDialog>
	);
};
