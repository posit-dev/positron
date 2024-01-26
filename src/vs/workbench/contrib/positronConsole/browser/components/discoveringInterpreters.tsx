/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./discoveringInterpreters';
import * as React from 'react';
import { localize } from 'vs/nls';

// Load localized copy for control.
const discoveringIntrepreters = localize('positron.discoveringInterpreters', "Discovering interpreters...");

/**
 * EmptyConsole component.
 * @returns The rendered component.
 */
export const DiscoveringInterpreters = () => {
	// Context hooks.

	// Render.
	return (
		<h1>{discoveringIntrepreters}</h1>
	);
};
