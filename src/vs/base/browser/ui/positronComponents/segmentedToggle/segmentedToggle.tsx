/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './segmentedToggle.css';

// React.
import React from 'react';

// Other dependencies.
import { Button } from '../button/button.js';
import { IHoverManager } from '../../../../../platform/hover/browser/hoverManager.js';
import { positronClassNames } from '../../../../common/positronUtilities.js';

/**
 * SegmentedToggleProps interface.
 */
export interface SegmentedToggleProps {
	readonly ariaLabel: string;
	readonly leftLabel: string;
	readonly rightLabel: string;
	/**
	 * Whether the left option is the selected one. The left option is what the switch reports as
	 * "on", so build the accessible name around the left label.
	 */
	readonly leftActive: boolean;
	/**
	 * Marks the toggle unavailable while leaving it focusable and in the tab order, so a keyboard
	 * user who lands on it is told it is unavailable instead of skipping past it.
	 */
	readonly disabled?: boolean;
	readonly className?: string;
	readonly hoverManager?: IHoverManager;
	readonly tooltip?: string | (() => string | undefined);
	readonly onToggle: () => void;
	ref?: React.Ref<HTMLButtonElement>;
}

/**
 * SegmentedToggle component.
 * A two-option segmented toggle switch. Standalone -- no action bar context required.
 *
 * The parent div element is hidden from assistive technology and the whole control is
 * named by `ariaLabel`, because VoiceOver reads a button with inner text as a group rather
 * than as a single control. The face also carries the track, so the unavailable state can
 * dim it without dimming the button's focus ring.
 */
export const SegmentedToggle = ({
	ariaLabel,
	leftLabel,
	rightLabel,
	leftActive,
	disabled,
	className,
	hoverManager,
	tooltip,
	onToggle,
	ref,
}: SegmentedToggleProps) => (
	<div className={positronClassNames('segmented-toggle', className)}>
		<Button
			ref={ref}
			ariaChecked={leftActive}
			ariaDisabled={disabled}
			ariaLabel={ariaLabel}
			className='toggle-container'
			hoverManager={hoverManager}
			role='switch'
			tooltip={tooltip}
			onPressed={onToggle}
		>
			<div aria-hidden='true' className='toggle-face'>
				<div className={positronClassNames('toggle-button', 'left', { 'highlighted': leftActive })}>
					{leftLabel}
				</div>
				<div className={positronClassNames('toggle-button', 'right', { 'highlighted': !leftActive })}>
					{rightLabel}
				</div>
			</div>
		</Button>
	</div>
);
