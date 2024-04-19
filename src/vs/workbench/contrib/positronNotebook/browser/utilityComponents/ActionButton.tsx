/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/
import 'vs/css!./ActionButton';

import * as React from 'react';
import { Button } from 'vs/base/browser/ui/positronComponents/button/button';

/**
 * Plain classed button for actions in notebook with common styles.
 * @param props The props for the button
 * @return A button with `action` and `action-button` classes added to it.
 */
// eslint-disable-next-line react/prop-types
export function ActionButton({ className, ...props }: React.ComponentProps<typeof Button>) {
	return <Button className={`action action-button ${className}`} {...props} />;
}
