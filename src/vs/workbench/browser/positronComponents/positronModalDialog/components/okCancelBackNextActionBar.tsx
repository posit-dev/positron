/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./OKCancelBackNextActionBar';
import * as React from 'react';
import { localize } from 'vs/nls';
import { Button } from 'vs/base/browser/ui/positronComponents/button/button';

/**
 * OKCancelBackNextActionBarProps interface.
 */
interface OKCancelBackNextActionBarProps {
	okButtonConfig?: ActionBarButtonConfig;
	cancelButtonConfig?: ActionBarButtonConfig;
	backButtonConfig?: ActionBarButtonConfig;
	nextButtonConfig?: ActionBarButtonConfig;
}

/**
 * ActionBarButtonConfig interface.
 */
interface ActionBarButtonConfig {
	title?: string;
	hide?: boolean;
	disable?: boolean;
	onClick?: () => void;
}

/**
 * OKCancelBackNextActionBar component.
 * @param props An OKCancelBackNextActionBarProps that contains the component properties.
 * @returns The rendered component.
 */
export const OKCancelBackNextActionBar = ({ okButtonConfig, cancelButtonConfig, backButtonConfig, nextButtonConfig }: OKCancelBackNextActionBarProps) => {
	// Render.
	return (
		<div className='ok-cancel-action-bar top-separator'>
			<div className='left-actions'>
				{backButtonConfig && !backButtonConfig?.hide && (
					<Button className='button action-bar-button' onPressed={backButtonConfig.onClick} disabled={backButtonConfig.disable ?? false}>
						{backButtonConfig.title ?? localize('positronBack', "Back")}
					</Button>
				)}
			</div>
			<div className='right-actions'>
				{cancelButtonConfig && !cancelButtonConfig?.hide && (
					<Button className='button action-bar-button' onPressed={cancelButtonConfig.onClick} disabled={cancelButtonConfig.disable ?? false}>
						{cancelButtonConfig.title ?? localize('positronCancel', "Cancel")}
					</Button>
				)}
				{okButtonConfig && !okButtonConfig?.hide && (
					<Button className='button action-bar-button default' onPressed={okButtonConfig.onClick} disabled={okButtonConfig.disable ?? false}>
						{okButtonConfig.title ?? localize('positronOK', "OK")}
					</Button>
				)}
				{nextButtonConfig && !nextButtonConfig.hide && (
					<Button className='button action-bar-button default' onPressed={nextButtonConfig.onClick} disabled={nextButtonConfig.disable ?? false}>
						{nextButtonConfig.title ?? localize('positronNext', "Next")}
					</Button>
				)}
			</div>
		</div>
	);
};
