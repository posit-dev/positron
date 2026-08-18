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
import { IPositronAssistantConfigurationService, IPositronLanguageModelConfig, IPositronLanguageModelSource, IShowLanguageModelConfigOptions } from '../common/interfaces/positronAssistantService.js';
import { PositronModalDialog } from '../../../browser/positronComponents/positronModalDialog/positronModalDialog.js';
import { ContentArea } from '../../../browser/positronComponents/positronModalDialog/components/contentArea.js';
import { PositronModalReactRenderer } from '../../../../base/browser/positronModalReactRenderer.js';
import { ProviderList } from './components/providerList.js';
import { ConnectProviderView } from './components/connectProviderView.js';
import { ConnectedProviderView } from './components/connectedProviderView.js';
import { ProviderModalFooter } from './components/providerModalFooter.js';
import { selectProviderView } from './providerConnection.js';
import { useProviderUpdates } from './useProviderUpdates.js';
import { usePositronReactServicesContext } from '../../../../base/browser/positronReactRendererContext.js';

/** Command that opens providers.json in an editor (registered in the contribution). */
const OPEN_PROVIDERS_JSON_COMMAND = 'workbench.action.positronAssistant.openAiProviderSettingsJson';

type OnAction = (source: IPositronLanguageModelSource, config: IPositronLanguageModelConfig, action: string) => Promise<void>;

export const showConfigureLLMProvidersModal = (
	sources: IPositronLanguageModelSource[],
	onAction: OnAction,
	onClose: () => void,
	options?: IShowLanguageModelConfigOptions,
) => {
	const renderer = new PositronModalReactRenderer();
	renderer.render(
		<div className='configure-llm-providers-modal' data-testid='configure-llm-providers-modal'>
			<ConfigureLLMProviders
				preselectedProviderId={options?.preselectedProviderId}
				renderer={renderer}
				sources={sources}
				onAction={onAction}
				onClose={onClose}
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
	onClose: () => void;
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
	//
	// The set is not fixed at open time either: a custom provider added to
	// providers.json registers a source, and deleting one unregisters it, both
	// of which can happen with the modal open.
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
		// Tracked ids follow the live list, so a provider that appears while the
		// modal is open gets its updates subscribed too.
		sources.map(s => s.provider.id),
		newSource => {
			setSources(prev => prev.map(s => s.provider.id === newSource.provider.id ? { ...newSource } : s));
			applySignedInTransition(newSource.provider.id, !!newSource.signedIn);
		},
		(providerId, signedIn) => {
			setSources(prev => prev.map(s => s.provider.id === providerId ? { ...s, signedIn } : s));
			applySignedInTransition(providerId, signedIn);
		},
		// A provider arriving or leaving changes the set rather than one entry,
		// so re-read the list instead of patching it.
		() => setSources(
			services.get(IPositronAssistantConfigurationService)
				.getRegisteredSources()
				.map(s => ({ ...s }))
		),
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

	// Unmounting the connect view drops its cancel handler, so Back and Close
	// both cancel an in-flight sign-in before leaving.
	const cancelPendingSignIn = () => {
		pendingCancelRef.current?.();
	};

	const close = () => {
		cancelPendingSignIn();
		props.onClose();
		props.renderer.dispose();
	};

	// Open providers.json for advanced editing, then close the modal so the editor
	// is visible. This discards unsaved form input, which the link's label calls out.
	const editRawConfig = () => {
		services.commandService.executeCommand(OPEN_PROVIDERS_JSON_COMMAND);
		close();
	};

	const backToList = () => {
		cancelPendingSignIn();
		setView('list');
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
					onBack={backToList}
					onClose={close}
					onEditRawConfig={editRawConfig}
					onPendingSignInChange={setPendingCancel}
				/>
			}
			{activeView === 'connected' && selectedSource &&
				<ConnectedProviderView
					source={selectedSource}
					onAction={props.onAction}
					onBack={backToList}
					onClose={close}
				/>
			}
		</PositronModalDialog>
	);
};
