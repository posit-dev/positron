/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./interpreterGroups';
import * as React from 'react';
import { useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { DisposableStore } from 'vs/base/common/lifecycle';
import { InterpreterGroup } from 'vs/workbench/browser/parts/positronTopActionBar/interpretersManagerModalPopup/interpreterGroup';
import { ILanguageRuntime, ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

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
	const preferredRuntimeByLanguageId = new Map<string, ILanguageRuntime>();
	const languageRuntimeGroups = new Map<string, IInterpreterGroup>();
	for (const runtime of languageRuntimeService.registeredRuntimes) {
		const languageId = runtime.metadata.languageId;

		// Get the preferred runtime for the language.
		let preferredRuntime = preferredRuntimeByLanguageId.get(languageId);
		if (!preferredRuntime) {
			preferredRuntime = languageRuntimeService.getPreferredRuntime(languageId);
			preferredRuntimeByLanguageId.set(languageId, preferredRuntime);
		}

		// Create the language runtime group if it doesn't exist.
		let languageRuntimeGroup = languageRuntimeGroups.get(languageId);
		if (!languageRuntimeGroup) {
			languageRuntimeGroup = { primaryRuntime: preferredRuntime, alternateRuntimes: [] };
			languageRuntimeGroups.set(languageId, languageRuntimeGroup);
		}

		// Add the runtime to the alternateRuntimes array if it's not the preferred runtime.
		if (runtime !== preferredRuntime) {
			languageRuntimeGroup.alternateRuntimes.push(runtime);
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
 * InterpreterGroups component.
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

		// Add our onDidRegisterRuntime event handler. This allows the set of runtimes to be dynamic
		// at app startup.
		disposableStore.add(props.languageRuntimeService.onDidRegisterRuntime(() => {
			setInterpreterGroups(createInterpreterGroups(props.languageRuntimeService));
		}));

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, []);

	// Render.
	return (
		<div className='interpreter-groups'>
			{interpreterGroups.map((interpreterGroup, index, runningRuntimes) => (
				<InterpreterGroup
					key={interpreterGroup.primaryRuntime.metadata.runtimeId}
					languageRuntimeService={props.languageRuntimeService}
					interpreterGroup={interpreterGroup}
					onStartRuntime={props.onStartRuntime}
					onActivateRuntime={props.onActivateRuntime}
				/>
			))}
		</div>
	);
};
