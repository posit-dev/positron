/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./discoveringInterpreters';
import * as React from 'react';
import { localize } from 'vs/nls';
import { usePositronConsoleContext } from 'vs/workbench/contrib/positronConsole/browser/positronConsoleContext';

// eslint-disable-next-line no-duplicate-imports
import { useEffect, useState } from 'react';

// Load localized copy for control.
const discoveringIntrepreters = localize('positron.discoveringInterpreters', "Discovering interpreters...");

/**
 * EmptyConsole component.
 * @returns The rendered component.
 */
export const DiscoveringInterpreters = () => {
	// Context hooks.

	// Hooks.
	const positronConsoleContext = usePositronConsoleContext();

	const [discovered, setDiscovered] =
		useState(positronConsoleContext.languageRuntimeService.registeredRuntimes.length);

	useEffect(() => {
		const disposables = positronConsoleContext.languageRuntimeService.onDidRegisterRuntime(
			_runtime => {
				setDiscovered(
					positronConsoleContext.languageRuntimeService.registeredRuntimes.length);
			});
		return () => disposables.dispose();
	});

	// Render.
	return (
		<h1>{discoveringIntrepreters} ({discovered})</h1>
	);
};
