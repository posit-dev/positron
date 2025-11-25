/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './IconedButton.css';

// React.
import React from 'react';

// Other dependencies.
import { ActionButton } from './ActionButton.js';
import { IHoverManager } from '../../../../../platform/hover/browser/hoverManager.js';
import { Icon } from '../../../../../platform/positronActionBar/browser/components/icon.js';
import { Icon as IconType } from '../../../../../platform/action/common/action.js';

/**
 * Button with icon to the left for notebook actions etc..
 * @param icon The icon to use for the button
 * @param label The label for the button
 * @param fullLabel The full label for accessibility
 * @param onClick The function to call when the button is clicked
 * @param bordered Whether to show a border
 * @param hoverManager Optional hover manager for tooltips
 * @returns A button with an icon as given by a codicon to the left.
 */
export function IconedButton({ icon, label, fullLabel = label, onClick, bordered = false, hoverManager }: { icon: IconType; label: string; fullLabel?: string; onClick: () => void; bordered?: boolean; hoverManager?: IHoverManager }) {
	return <ActionButton
		ariaLabel={fullLabel}
		className={`positron-iconed-button ${bordered ? 'bordered' : ''}`}
		hoverManager={hoverManager}
		tooltip={fullLabel}
		onPressed={onClick}
	>
		<Icon className={'button-icon'} icon={icon} />
		<span className='action-label'>
			{label}
		</span>
	</ActionButton>;
}
