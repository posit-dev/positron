/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React from 'react';

// Other dependencies.
import { Button } from '../../../../../../base/browser/ui/positronComponents/button/button.js';

interface CellActionButtonProps {
	ariaLabel: string;
	onPressed: () => void;
	children: React.ReactNode;
	buttonRef?: React.RefObject<HTMLButtonElement>;
	ariaHasPopup?: boolean | 'menu' | 'listbox' | 'tree' | 'grid' | 'dialog';
	ariaExpanded?: boolean;
}

/**
 * Standardized action button component for notebook cell actions.
 * Provides consistent styling and behavior across all cell action buttons.
 */
export function CellActionButton({ ariaLabel, onPressed, children, buttonRef, ariaHasPopup, ariaExpanded }: CellActionButtonProps) {
	// We need to wrap the Button in a div to add additional ARIA attributes
	// since the Button component doesn't pass through extra props
	const button = (
		<Button
			ref={buttonRef}
			ariaLabel={ariaLabel}
			className='action action-button'
			onPressed={onPressed}
		>
			{children}
		</Button>
	);

	// If we have additional ARIA attributes, wrap in a div
	if (ariaHasPopup !== undefined || ariaExpanded !== undefined) {
		return (
			<div
				aria-expanded={ariaExpanded}
				aria-haspopup={ariaHasPopup}
			>
				{button}
			</div>
		);
	}

	return button;
}
