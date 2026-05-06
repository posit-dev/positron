/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './dataConnectionsTabButton.css';

// Other dependencies.
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';

/**
 * DataTabButtonProps interface.
 */
interface DataTabButtonProps {
	// Whether the tab button is active.
	readonly active: boolean;

	// The ID of the panel this tab controls.
	readonly ariaControls: string;

	// The label of the tab button.
	readonly label: string;

	// A callback that is called when the tab button is pressed.
	readonly onPressed: () => void;
}

/**
 * DataTabButton component.
 */
export const DataTabButton = ({ active, ariaControls, label, onPressed }: DataTabButtonProps) => {
	// Render.
	return (
		<Button
			ariaControls={ariaControls}
			ariaSelected={active}
			className='data-tab-button'
			role='tab'
			onPressed={onPressed}
		>
			<div className='label'>{label}</div>
			<div className={positronClassNames(
				'active-indicator',
				{ 'active': active }
			)} />
		</Button>
	);
};
