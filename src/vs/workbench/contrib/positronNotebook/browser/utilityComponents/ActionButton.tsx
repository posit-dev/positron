/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './ActionButton.css';

// React.
import React from 'react';

// Other dependencies.
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';

/**
 * Plain classed button for actions in notebook with common styles.
 * @param props The props for the button
 * @return A button with `action` and `action-button` classes added to it.
 */
// eslint-disable-next-line react/prop-types
export function ActionButton({ className, ...props }: React.ComponentProps<typeof Button>) {
	return <Button className={`action action-button ${className}`} {...props} />;
}
