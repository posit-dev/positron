/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./OKCancelBackNextActionBar';
import * as React from 'react';
import { localize } from 'vs/nls';

/**
 * OKCancelBackNextActionBarProps interface.
 */
interface OKCancelBackNextActionBarProps {
	okButtonConfig: ActionBarButtonConfig;
	cancelButtonConfig: ActionBarButtonConfig;
	backButtonConfig: ActionBarButtonConfig;
	nextButtonConfig: ActionBarButtonConfig;
}

/**
 * ActionBarButtonConfig interface.
 */
interface ActionBarButtonConfig {
	title?: string;
	hide?: boolean;
	disable?: boolean;
	onClick: () => void;
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
				{!backButtonConfig.hide && (
					<button className='button action-bar-button' tabIndex={0} onClick={backButtonConfig.onClick} disabled={backButtonConfig.disable ?? false}>
						{backButtonConfig.title ?? localize('positronBack', "Back")}
					</button>
				)}
			</div>
			<div className='right-actions'>
				{!cancelButtonConfig.hide && (
					<button className='button action-bar-button' tabIndex={0} onClick={cancelButtonConfig.onClick} disabled={cancelButtonConfig.disable ?? false}>
						{cancelButtonConfig.title ?? localize('positronCancel', "Cancel")}
					</button>
				)}
				{!okButtonConfig.hide && (
					<button className='button action-bar-button default' tabIndex={0} onClick={okButtonConfig.onClick} disabled={okButtonConfig.disable ?? false}>
						{okButtonConfig.title ?? localize('positronOK', "OK")}
					</button>
				)}
				{!nextButtonConfig.hide && (
					<button className='button action-bar-button default' tabIndex={0} onClick={nextButtonConfig.onClick} disabled={nextButtonConfig.disable ?? false}>
						{nextButtonConfig.title ?? localize('positronNext', "Next")}
					</button>
				)}
			</div>
		</div>
	);
};
