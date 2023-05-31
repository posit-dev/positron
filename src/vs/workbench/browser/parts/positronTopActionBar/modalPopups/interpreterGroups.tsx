/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./interpreterGroups';
import * as React from 'react';
import { useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { DisposableStore } from 'vs/base/common/lifecycle';
import { InterpreterGroup } from 'vs/workbench/browser/parts/positronTopActionBar/modalPopups/interpreterGroup';
import { ILanguageRuntime, ILanguageRuntimeService, RuntimeState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

/**
 * IInterpreterGroup interface.
 */
export interface IInterpreterGroup {
	primaryRuntime: ILanguageRuntime;
	alternateRuntimes: ILanguageRuntime[];
}

/**
 * Creates an IInterpreterGroup array representing the available language runtimes.
 * @param languageRuntimeService The ILanguageRuntimeService.
 * @returns An IInterpreterGroup array representing the available language runtimes.
 */
const createInterpreterGroups = (languageRuntimeService: ILanguageRuntimeService) => {
	const languageRuntimeGroups = new Map<string, IInterpreterGroup>();
	for (const runtime of languageRuntimeService.registeredRuntimes) {
		const languageRuntimeGroup = languageRuntimeGroups.get(runtime.metadata.languageId);
		if (languageRuntimeGroup) {
			switch (runtime.getRuntimeState()) {
				case RuntimeState.Uninitialized:
				case RuntimeState.Exited:
					languageRuntimeGroup.alternateRuntimes.push(runtime);
					break;

				default:
					languageRuntimeGroup.alternateRuntimes.push(languageRuntimeGroup.primaryRuntime);
					languageRuntimeGroup.primaryRuntime = runtime;
					break;
			}
		} else {
			languageRuntimeGroups.set(runtime.metadata.languageId, {
				primaryRuntime: runtime,
				alternateRuntimes: []
			});
		}
	}


	// Sort the runtimes by language name.
	return Array.from(languageRuntimeGroups.values()).sort((a, b) => {
		if (a.primaryRuntime.metadata.languageName < b.primaryRuntime.metadata.languageName) {
			return -1;
		} else if (a.primaryRuntime.metadata.languageName > b.primaryRuntime.metadata.languageName) {
			return 1;
		} else {
			return 0;
		}
	});
};

/**
 * InterpreterGroupsProps interface.
 */
interface InterpreterGroupsProps {
	languageRuntimeService: ILanguageRuntimeService;
	onStartRuntime: (runtime: ILanguageRuntime) => Promise<void>;
	onActivateRuntime: (runtime: ILanguageRuntime) => Promise<void>;
}

/**
 * InterpreterGroupsManager component.
 * @param props A InterpreterGroupsProps that contains the component properties.
 * @returns The rendered component.
 */
export const InterpreterGroups = (props: InterpreterGroupsProps) => {
	// State hooks.
	const [interpreterGroups, setInterpreterGroups] =
		useState(createInterpreterGroups(props.languageRuntimeService));

	// Main useEffect hook.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add our onDidChangeRegisteredRuntimes event handler. This allows the set of runtimes to
		// be dynamic at app startup.
		disposableStore.add(props.languageRuntimeService.onDidChangeRegisteredRuntimes(() => {
			setInterpreterGroups(createInterpreterGroups(props.languageRuntimeService));
		}));

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, []);

	// Render.
	return (
		<div className='interpreter-groups'>
			{interpreterGroups.map((interpreterGroup, index, runningRuntimes) => (
				<>
					<InterpreterGroup
						key={interpreterGroup.primaryRuntime.metadata.runtimeId}
						languageRuntimeService={props.languageRuntimeService}
						interpreterGroup={interpreterGroup}
						onStartRuntime={props.onStartRuntime}
						onActivateRuntime={props.onActivateRuntime}
					/>
				</>
			))}
		</div>
	);
};
