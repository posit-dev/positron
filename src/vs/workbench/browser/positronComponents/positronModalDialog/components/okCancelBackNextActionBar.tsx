/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './okCancelBackNextActionBar.css';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';
import * as platform from '../../../../../base/common/platform.js';

/**
 * OKCancelBackNextActionBarProps interface.
 */
export interface OKCancelBackNextActionBarProps {
	okButtonConfig?: ActionBarButtonConfig;
	cancelButtonConfig?: ActionBarButtonConfig;
	backButtonConfig?: ActionBarButtonConfig;
	nextButtonConfig?: ActionBarButtonConfig;
}

/**
 * ActionBarButtonConfig interface.
 */
export interface ActionBarButtonConfig {
	title?: string;
	disable?: boolean;
	/** When true, the button shows an in-button spinner and is disabled. */
	loading?: boolean;
	onClick?: () => void;
}

/**
 * OKCancelBackNextActionBar component.
 * @param props An OKCancelBackNextActionBarProps that contains the component properties.
 * @returns The rendered component.
 */
export const OKCancelBackNextActionBar = ({ okButtonConfig, cancelButtonConfig, backButtonConfig, nextButtonConfig }: OKCancelBackNextActionBarProps) => {
	// Renders one action-bar button from its config, showing a spinner (and
	// forcing the disabled state) while the button's action is loading.
	const renderButton = (config: ActionBarButtonConfig | undefined, className: string, defaultTitle: string) => {
		if (!config) {
			return null;
		}
		return (
			<Button className={className} disabled={(config.disable ?? false) || (config.loading ?? false)} onPressed={config.onClick}>
				{config.loading && <span aria-hidden='true' className='codicon codicon-loading codicon-modifier-spin' />}
				{config.title ?? defaultTitle}
			</Button>
		);
	};

	const cancelButton = renderButton(cancelButtonConfig, 'action-bar-button', localize('positronCancel', "Cancel"));
	const okButton = renderButton(okButtonConfig, 'action-bar-button default', localize('positronOK', "OK"));
	const nextButton = renderButton(nextButtonConfig, 'action-bar-button default', localize('positronNext', "Next"));

	// Render.
	return (
		<div className='ok-cancel-back-action-bar'>
			<div className='left-actions'>
				{renderButton(backButtonConfig, 'action-bar-button', localize('positronBack', "Back"))}
			</div>
			<div className='right-actions'>
				{platform.isWindows
					? <>{nextButton}{okButton}{cancelButton}</>
					: <>{cancelButton}{nextButton}{okButton}</>
				}
			</div>
		</div>
	);
};
