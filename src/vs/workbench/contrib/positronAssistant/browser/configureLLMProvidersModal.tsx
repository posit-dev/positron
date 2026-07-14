/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Other dependencies.
import { localize } from '../../../../nls.js';
import { IPositronLanguageModelConfig, IPositronLanguageModelSource, IShowLanguageModelConfigOptions } from '../common/interfaces/positronAssistantService.js';
import { OKModalDialog } from '../../../browser/positronComponents/positronModalDialog/positronOKModalDialog.js';
import { PositronModalReactRenderer } from '../../../../base/browser/positronModalReactRenderer.js';
import { VerticalStack } from '../../../browser/positronComponents/positronModalDialog/components/verticalStack.js';

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
 * Opens the new "Configure LLM Providers" modal.
 *
 * This is a minimal shell: it renders the dialog chrome so the feature switch
 * has something to open, while the header/footer controls and provider
 * configuration flows are built out in follow-up work (see
 * https://github.com/posit-dev/positron/issues/14815).
 *
 * The signature mirrors {@link showLanguageModelModalDialog} so the two modals
 * are interchangeable at the single call site that reads the feature switch.
 */
export const showConfigureLLMProvidersModal = (
	_sources: IPositronLanguageModelSource[],
	_onAction: (source: IPositronLanguageModelSource, config: IPositronLanguageModelConfig, action: string) => Promise<void>,
	onClose: () => void,
	_options?: IShowLanguageModelConfigOptions,
) => {
	const renderer = new PositronModalReactRenderer();

	renderer.render(
		<div className='configure-llm-providers-modal'>
			<ConfigureLLMProviders renderer={renderer} onClose={onClose} />
		</div>
	);
};

interface ConfigureLLMProvidersProps {
	renderer: PositronModalReactRenderer;
	onClose: () => void;
}

const ConfigureLLMProviders = (props: ConfigureLLMProvidersProps) => {
	// Notify the caller and tear down the modal DOM. Both are required: the
	// renderer must be disposed or the dialog stays mounted after Close.
	const onClose = () => {
		props.onClose();
		props.renderer.dispose();
	};

	return <OKModalDialog
		height={500}
		okButtonTitle={localize('positron.configureLLMProvidersModal.close', "Close")}
		renderer={props.renderer}
		title={localize('positron.configureLLMProvidersModal.title', "Configure LLM Providers")}
		width={600}
		onAccept={onClose}
		onCancel={onClose}
	>
		<VerticalStack>
			<p>
				{localize('positron.configureLLMProvidersModal.placeholder', "This is the new provider configuration experience. It's still being built.")}
			</p>
		</VerticalStack>
	</OKModalDialog>;
};
