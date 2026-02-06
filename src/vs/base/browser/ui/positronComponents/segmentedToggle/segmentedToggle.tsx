/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './segmentedToggle.css';

// React.
import React from 'react';

// Other dependencies.
import { positronClassNames } from '../../../../common/positronUtilities.js';

/**
 * SegmentedToggleProps interface.
 */
export interface SegmentedToggleProps {
	readonly ariaLabel: string;
	readonly leftLabel: string;
	readonly rightLabel: string;
	readonly leftActive: boolean;
	readonly disabled?: boolean;
	readonly className?: string;
	readonly onToggle: () => void;
}

/**
 * SegmentedToggle component.
 * A two-option segmented toggle switch. Standalone -- no action bar context required.
 */
export const SegmentedToggle: React.FC<SegmentedToggleProps> = ({
	ariaLabel,
	leftLabel,
	rightLabel,
	leftActive,
	disabled,
	className,
	onToggle,
}) => (
	<div className={positronClassNames('segmented-toggle', className)}>
		<button
			aria-checked={leftActive}
			aria-label={ariaLabel}
			className={positronClassNames('toggle-container', { 'disabled': disabled })}
			disabled={disabled}
			onClick={onToggle}
		>
			<div className={positronClassNames('toggle-button', 'left', { 'highlighted': leftActive })}>
				{leftLabel}
			</div>
			<div className={positronClassNames('toggle-button', 'right', { 'highlighted': !leftActive })}>
				{rightLabel}
			</div>
		</button>
	</div>
);
