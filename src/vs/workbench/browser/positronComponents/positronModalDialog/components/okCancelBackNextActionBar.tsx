/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './okCancelBackNextActionBar.css';

// React.
import React from 'react';

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
interface ActionBarButtonConfig {
	title?: string;
	disable?: boolean;
	onClick?: () => void;
}

/**
 * OKCancelBackNextActionBar component.
 * @param props An OKCancelBackNextActionBarProps that contains the component properties.
 * @returns The rendered component.
 */
export const OKCancelBackNextActionBar = ({ okButtonConfig, cancelButtonConfig, backButtonConfig, nextButtonConfig }: OKCancelBackNextActionBarProps) => {
	const cancelButton = (cancelButtonConfig ?
		<Button className='action-bar-button' onPressed={cancelButtonConfig.onClick} disabled={cancelButtonConfig.disable ?? false}>
			{cancelButtonConfig.title ?? localize('positronCancel', "Cancel")}
		</Button> : null);
	const okButton = (okButtonConfig ?
		<Button className='action-bar-button default' onPressed={okButtonConfig.onClick} disabled={okButtonConfig.disable ?? false}>
			{okButtonConfig.title ?? localize('positronOK', "OK")}
		</Button> : null);
	const nextButton = (nextButtonConfig ?
		<Button className='action-bar-button default' onPressed={nextButtonConfig.onClick} disabled={nextButtonConfig.disable ?? false}>
			{nextButtonConfig.title ?? localize('positronNext', "Next")}
		</Button> : null);

	// Render.
	return (
		<div className='ok-cancel-action-bar top-separator'>
			<div className='left-actions'>
				{backButtonConfig ?
					<Button className='action-bar-button' onPressed={backButtonConfig.onClick} disabled={backButtonConfig.disable ?? false}>
						{backButtonConfig.title ?? localize('positronBack', "Back")}
					</Button> : null
				}
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
