/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './dataTabButton.css';

// Other dependencies.
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';

/**
 * DataTabButtonProps interface.
 */
interface DataTabButtonProps {
	// The label of the tab button.
	readonly label: string;

	// Whether the tab button is active.
	readonly active: boolean;

	// A callback that is called when the tab button is pressed.
	readonly onPressed: () => void;
}

/**
 * DataTabButton component.
 */
export const DataTabButton = ({ label, active, onPressed }: DataTabButtonProps) => {
	// Render.
	return (
		<Button className='data-tab-button' onPressed={onPressed}>
			<div className='label'>{label}</div>
			<div className={positronClassNames(
				'active-indicator',
				{ 'active': active }
			)} />
		</Button>
	);
};
