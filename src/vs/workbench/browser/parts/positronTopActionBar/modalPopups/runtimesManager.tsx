/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./runtimesManager';
import * as React from 'react';
import { useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports
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
 * ILanguageRuntimeGroup interface.
 */
interface ILanguageRuntimeGroup {
	runtime: ILanguageRuntime;
	alternateRuntimes: ILanguageRuntime[];
}

const createLanguageRuntimeGroups = (languageRuntimeService: ILanguageRuntimeService) => {
	const languageRuntimeGroups = new Map<string, ILanguageRuntimeGroup>();
	for (const runtime of languageRuntimeService.registeredRuntimes) {
		const languageRuntimeGroup = languageRuntimeGroups.get(runtime.metadata.languageId);
		if (languageRuntimeGroup) {
			languageRuntimeGroup.alternateRuntimes.push(runtime);
		} else {
			languageRuntimeGroups.set(runtime.metadata.languageId, {
				runtime: runtime,
				alternateRuntimes: []
			});
		}
	}

	// Sort the runtimes by language name.
	return Array.from(languageRuntimeGroups.values()).sort((a, b) => {
		if (a.runtime.metadata.languageName < b.runtime.metadata.languageName) {
			return -1;
		} else if (a.runtime.metadata.languageName > b.runtime.metadata.languageName) {
			return 1;
		} else {
			return 0;
		}
	});
};

/**
 * RuntimesManager component.
 * @param props A RuntimesManagerProps that contains the component properties.
 * @returns The rendered component.
 */
export const RuntimesManager = (props: RuntimesManagerProps) => {
	// State hooks.
	const [runtimeGroups, setRuntimeGroups] =
		useState(createLanguageRuntimeGroups(props.languageRuntimeService));

	// Main useEffect hook.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add our onDidChangeRegisteredRuntimes event handler. This allows the set of runtimes to
		// be dynamic at app startup.
		disposableStore.add(props.languageRuntimeService.onDidChangeRegisteredRuntimes(() => {
			setRuntimeGroups(createLanguageRuntimeGroups(props.languageRuntimeService));
		}));

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, []);

	// Render.
	return (
		<div className='runtimes-manager'>
			{runtimeGroups.map((runtimeGroup, index, runningRuntimes) => (
				<>
					<RuntimeManager
						key={runtimeGroup.runtime.metadata.runtimeId}
						languageRuntimeService={props.languageRuntimeService}
						runtime={runtimeGroup.runtime}
						dismiss={props.dismiss} />
				</>
			))}
		</div>
	);
};
