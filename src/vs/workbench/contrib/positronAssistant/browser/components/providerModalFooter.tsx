/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './providerModalFooter.css';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import * as platform from '../../../../../base/common/platform.js';
import { FooterButton } from '../../../../browser/positronComponents/positronDynamicModalDialog/components/footerButton.js';

/**
 * ProviderFooterButtonConfig interface.
 */
export interface ProviderFooterButtonConfig {
	title: string;
	disable?: boolean;
	/** When true, the button shows an in-button spinner and is disabled. */
	loading?: boolean;
	/**
	 * When true, this button becomes the dialog form's submit target, so pressing
	 * Enter in a field activates it. Only one button per footer may set this.
	 */
	submit?: boolean;
	onClick: () => void;
}

/**
 * ProviderModalFooterProps interface.
 */
export interface ProviderModalFooterProps {
	/** Renders a Back button (returning to the provider list) when provided. */
	onBack?: () => void;
	/** The view's primary action button, if it has one. */
	primaryButton?: ProviderFooterButtonConfig;
	/** The view's optional secondary button, e.g. Remove on an errored provider. */
	cancelButton?: ProviderFooterButtonConfig;
}

/**
 * Renders one footer button from its config, showing a spinner (and forcing the
 * disabled state) while the button's action is loading.
 */
const footerButton = (config: ProviderFooterButtonConfig | undefined, isDefault: boolean) => {
	if (!config) {
		return null;
	}
	return (
		<FooterButton
			default={isDefault}
			disabled={(config.disable ?? false) || (config.loading ?? false)}
			type={config.submit ? 'submit' : 'button'}
			onPressed={config.onClick}
		>
			{config.loading && <span aria-hidden='true' className='codicon codicon-loading codicon-modifier-spin' />}
			{config.title}
		</FooterButton>
	);
};

/**
 * The footer shared by the Configure LLM Providers modal views: an optional Back
 * button on the left, and the view's optional secondary and primary buttons on
 * the right. There is no Close button, because the dialog's title bar carries the
 * close control.
 * @param props A ProviderModalFooterProps that contains the component properties.
 * @returns The rendered component.
 */
export const ProviderModalFooter = ({ onBack, primaryButton, cancelButton }: ProviderModalFooterProps) => {
	const primary = footerButton(primaryButton, true);
	const secondary = footerButton(cancelButton, false);

	return (
		<div className='provider-modal-footer'>
			{onBack
				? <FooterButton onPressed={onBack}>
					{localize('positron.configureLLMProvidersModal.back', "Back")}
				</FooterButton>
				: <div />
			}
			<div className='provider-modal-footer-right'>
				{/* On Windows, the primary button comes first; on macOS/Linux, the secondary button comes first. */}
				{platform.isWindows
					? <>{primary}{secondary}</>
					: <>{secondary}{primary}</>
				}
			</div>
		</div>
	);
};
