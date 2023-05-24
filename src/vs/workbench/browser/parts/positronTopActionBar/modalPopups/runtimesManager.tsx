/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./runtimesManager';
import * as React from 'react';
import { useEffect } from 'react'; // eslint-disable-line no-duplicate-imports
import { DisposableStore } from 'vs/base/common/lifecycle';
import { RuntimeManager } from 'vs/workbench/browser/parts/positronTopActionBar/modalPopups/runtimeManager';
import { ILanguageRuntime, ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

/**
 * RuntimesManagerProps interface.
 */
interface RuntimesManagerProps {
	languageRuntimeService: ILanguageRuntimeService;
	dismiss: () => void;
}

/**
 * RuntimesManager component.
 * @param props A RuntimesManagerProps that contains the component properties.
 * @returns The rendered component.
 */
export const RuntimesManager = (props: RuntimesManagerProps) => {
	// State hooks.
	//const [runtimes, setRuntimes] = useState(props.languageRuntimeService.curatedRuntimes);

	// Main useEffect hook.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		disposableStore.add(props.languageRuntimeService.onDidChangeRegisteredRuntimes(() => {

		}));

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, []);

	const foo = () => {
		// Get the set of registered runtimes.
		const registeredRuntimes = props.languageRuntimeService.registeredRuntimes;

		// Get the top runtime for each language ID. The order of the runtimes for a given language
		// isn't random. Runtimes are sorted by priority when registered by the extension so the
		// first one is the best one to start.
		const runtimesByLanguageId = new Map<string, ILanguageRuntime>();
		for (const registeredRuntime of registeredRuntimes) {
			if (!runtimesByLanguageId.has(registeredRuntime.metadata.languageId)) {
				runtimesByLanguageId.set(registeredRuntime.metadata.languageId, registeredRuntime);
			}
		}

		// Sort the runtimes by language name.
		return Array.from(runtimesByLanguageId.values()).sort((a, b) => {
			if (a.metadata.languageName < b.metadata.languageName) {
				return -1;
			} else if (a.metadata.languageName > b.metadata.languageName) {
				return 1;
			} else {
				return 0;
			}
		});

	};

	// Get the curated runtimes.
	const curatedRuntimes = foo();

	// // Calculate the height.
	// const height = 8 +							// Top and bottom margin.
	// 	(curatedRuntimes.length * 75) +		// Runtime components.
	// 	((curatedRuntimes.length - 1) * 4);	// Separators between runtime components.

	// Render.
	return (
		<div className='runtimes-manager'>
			{curatedRuntimes.map((runtime, index, runningRuntimes) => (
				<>
					<RuntimeManager
						key={runtime.metadata.runtimeId}
						languageRuntimeService={props.languageRuntimeService}
						runtime={runtime}
						dismiss={props.dismiss} />
					{index < runningRuntimes.length - 1 && <div className='separator' />}
				</>
			))}
		</div>
	);
};
