/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './ActionButton.css';

// React.
import React, { PropsWithChildren } from 'react';

// Other dependencies.
import { Button, ButtonProps } from '../../../../../base/browser/ui/positronComponents/button/button.js';

/**
 * Plain classed button for actions in notebook with common styles.
 * @param props The props for the button
 * @return A button with `action` and `action-button` classes added to it.
 */
export const ActionButton = React.forwardRef<HTMLButtonElement, PropsWithChildren<ButtonProps>>(
	({ className, ...props }, ref) => {
		return <Button ref={ref} className={`action action-button ${className}`} {...props} />;
	}
);
ActionButton.displayName = 'ActionButton';
