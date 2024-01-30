/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./discoveringInterpreters';
import * as React from 'react';
import { localize } from 'vs/nls';
import { usePositronConsoleContext } from 'vs/workbench/contrib/positronConsole/browser/positronConsoleContext';
import { ProgressBar } from 'vs/base/browser/ui/progressbar/progressbar';

// eslint-disable-next-line no-duplicate-imports
import { useEffect, useState } from 'react';
import { DisposableStore } from 'vs/base/common/lifecycle';

// Load localized copy for control.
const discoveringIntrepreters = localize('positron.discoveringInterpreters', "Discovering interpreters");

/**
 * DiscoveringInterpreters component.
 *
 * @returns The rendered component.
 */
export const DiscoveringInterpreters = () => {
	const progressRef = React.useRef<HTMLDivElement>(null);

	const positronConsoleContext = usePositronConsoleContext();

	// Component state.
	const [discovered, setDiscovered] =
		useState(positronConsoleContext.languageRuntimeService.registeredRuntimes.length);

	useEffect(() => {
		const disposableStore = new DisposableStore();

		// Create a progress bar and add it to the disposable store.
		let bar: ProgressBar | undefined;
		if (progressRef.current) {
			bar = new ProgressBar(progressRef.current);
			// Infinite progress since we don't know how many interpreters we're discovering.
			bar.infinite();
			disposableStore.add(bar);
		}

		// When each interpreter is discovered, update the count.
		disposableStore.add(positronConsoleContext.languageRuntimeService.onDidRegisterRuntime(
			_runtime => {
				setDiscovered(
					positronConsoleContext.languageRuntimeService.registeredRuntimes.length);
			}));

		// Return the cleanup function that will dispose of the disposables.
		return () => {
			bar?.done();
			disposableStore.dispose();
		};
	});

	// Render.
	return (
		<div className='discovering'>
			<div className='progress' ref={progressRef}></div>
			<div className='discovery'>{discoveringIntrepreters}
				{discovered > 0 && <span> ({discovered})</span>}...</div>
		</div>
	);
};
