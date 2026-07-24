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
import { IPositronLanguageModelConfig, IPositronLanguageModelSource, IShowLanguageModelConfigOptions } from '../common/interfaces/positronAssistantService.js';
import { PositronModalDialog } from '../../../browser/positronComponents/positronModalDialog/positronModalDialog.js';
import { ContentArea } from '../../../browser/positronComponents/positronModalDialog/components/contentArea.js';
import { PositronModalReactRenderer } from '../../../../base/browser/positronModalReactRenderer.js';
import { ProviderList } from './components/providerList.js';
import { ConnectProviderView } from './components/connectProviderView.js';
import { ConnectedProviderView } from './components/connectedProviderView.js';
import { NotYetSupportedView } from './components/notYetSupportedView.js';
import { ProviderModalFooter } from './components/providerModalFooter.js';
import { deriveConnectAction, deriveDisconnectAction, selectProviderView } from './providerConnection.js';
import { useProviderUpdates } from './useProviderUpdates.js';

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

export const showConfigureLLMProvidersModal = (
	sources: IPositronLanguageModelSource[],
	onAction: OnAction,
	onClose: () => void,
	_options?: IShowLanguageModelConfigOptions,
) => {
	const renderer = new PositronModalReactRenderer();
	renderer.render(
		<div className='configure-llm-providers-modal' data-testid='configure-llm-providers-modal'>
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

	// The selected provider, always read from the fresh sources. Defensive: if it
	// ever cannot be resolved while on a detail view, fall back to the list.
	const selectedSource = sources.find(s => s.provider.id === selectedProviderId);
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
							onAddCustomProvider={() => { setSelectedProviderId(undefined); setView('notSupported'); }}
							onSelectProvider={source => { setSelectedProviderId(source.provider.id); setView(selectProviderView(source)); }}
						/>
					</ContentArea>
					<ProviderModalFooter onClose={close} />
				</>
			}
			{activeView === 'connect' && selectedSource &&
				<ConnectProviderView
					source={selectedSource}
					onBack={() => setView('list')}
					onCancelSignIn={() => { props.onAction(selectedSource, selectedSource.defaults, 'cancel'); }}
					onClose={close}
					onConnect={config => props.onAction(selectedSource, config, deriveConnectAction(selectedSource))}
					onPendingSignInChange={setPendingCancel}
					onRemove={() => props.onAction(selectedSource, selectedSource.defaults, deriveDisconnectAction(selectedSource))}
				/>
			}
			{activeView === 'connected' && selectedSource &&
				<ConnectedProviderView
					source={selectedSource}
					onBack={() => setView('list')}
					onClose={close}
					onDisconnect={() => props.onAction(selectedSource, selectedSource.defaults, deriveDisconnectAction(selectedSource))}
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
