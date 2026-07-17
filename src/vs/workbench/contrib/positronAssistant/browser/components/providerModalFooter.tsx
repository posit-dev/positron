/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../nls.js';
import { ActionBarButtonConfig, OKCancelBackNextActionBar } from '../../../../browser/positronComponents/positronModalDialog/components/okCancelBackNextActionBar.js';

export interface ProviderModalFooterProps {
	/** Renders a Back button (returning to the provider list) when provided. */
	onBack?: () => void;
	/** Invoked by the Close button. */
	onClose: () => void;
	/** The view's primary action button, if it has one. */
	primaryButton?: ActionBarButtonConfig;
	/** The view's optional cancel button configuration. */
	cancelButton?: ActionBarButtonConfig;

}

/**
 * The footer action bar shared by the Configure LLM Providers modal views:
 * an optional Back button, a Close button, and the view's optional primary
 * action button, which reads the view's own state directly.
 */
export const ProviderModalFooter = ({ onBack, onClose, primaryButton, cancelButton }: ProviderModalFooterProps) => (
	<OKCancelBackNextActionBar
		backButtonConfig={onBack ? { onClick: onBack } : undefined}
		cancelButtonConfig={cancelButton ?? { title: localize('positron.configureLLMProvidersModal.close', "Close"), onClick: onClose }}
		nextButtonConfig={primaryButton}
	/>
);
