/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import 'vs/css!./IconedButton';

import * as React from 'react';
import { ActionButton } from './ActionButton';

/**
 * Button with icon to the left for notebook actions etc..
 * @param codicon The codicon to use for the button
 * @param label The label for the button
 * @param onClick The function to call when the button is clicked
 * @returns A button with an icon as given by a codicon to the left.
 */
export function IconedButton({ codicon, label, fullLabel = label, onClick, bordered = false }: { codicon: string; label: string; fullLabel?: string; onClick: () => void; bordered?: boolean }) {
	return <ActionButton
		className={`positron-iconed-button ${bordered ? 'bordered' : ''}`}
		ariaLabel={fullLabel}
		onPressed={onClick}
	>
		<div className={`button-icon codicon codicon-${codicon}`} />
		<span className='action-label'>
			{label}
		</span>
	</ActionButton>;
}
