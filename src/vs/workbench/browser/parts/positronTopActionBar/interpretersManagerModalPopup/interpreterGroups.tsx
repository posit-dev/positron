/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './interpreterGroups.css';

// React.
import React, { useEffect, useState } from 'react';

// Other dependencies.
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { InterpreterGroup } from './interpreterGroup.js';
import { ILanguageRuntimeMetadata, ILanguageRuntimeService } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { IRuntimeStartupService } from '../../../../services/runtimeStartup/common/runtimeStartupService.js';

/**
 * IInterpreterGroup interface.
 */
export interface IInterpreterGroup {
	primaryRuntime: ILanguageRuntimeMetadata;
	alternateRuntimes: ILanguageRuntimeMetadata[];
}

/**
 * Creates an IInterpreterGroup array representing the available language runtimes.
 * @param languageRuntimeService The ILanguageRuntimeService.
 * @returns An IInterpreterGroup array representing the available language runtimes.
 */
const createInterpreterGroups = (
	languageRuntimeService: ILanguageRuntimeService,
	runtimeAffiliationService: IRuntimeStartupService) => {
	const preferredRuntimeByLanguageId = new Map<string, ILanguageRuntimeMetadata>();
	const languageRuntimeGroups = new Map<string, IInterpreterGroup>();
	for (const runtime of languageRuntimeService.registeredRuntimes) {
		const languageId = runtime.languageId;

		// Get the preferred runtime for the language.
		let preferredRuntime = preferredRuntimeByLanguageId.get(languageId);
		if (!preferredRuntime) {
			preferredRuntime = runtimeAffiliationService.getPreferredRuntime(languageId);
			preferredRuntimeByLanguageId.set(languageId, preferredRuntime);
		}

		// Create the language runtime group if it doesn't exist.
		let languageRuntimeGroup = languageRuntimeGroups.get(languageId);
		if (!languageRuntimeGroup) {
			languageRuntimeGroup = { primaryRuntime: preferredRuntime, alternateRuntimes: [] };
			languageRuntimeGroups.set(languageId, languageRuntimeGroup);
		}

		// Add the runtime to the alternateRuntimes array if it's not the preferred runtime.
		if (runtime.runtimeId !== preferredRuntime.runtimeId) {
			languageRuntimeGroup.alternateRuntimes.push(runtime);
		}
	}

	// Sort the runtimes by language name.
	return Array.from(languageRuntimeGroups.values()).sort((a, b) => {
		if (a.primaryRuntime.languageName < b.primaryRuntime.languageName) {
			return -1;
		} else if (a.primaryRuntime.languageName > b.primaryRuntime.languageName) {
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
	runtimeAffiliationService: IRuntimeStartupService;
	runtimeSessionService: IRuntimeSessionService;
	onStartRuntime: (runtime: ILanguageRuntimeMetadata) => Promise<void>;
	onActivateRuntime: (runtime: ILanguageRuntimeMetadata) => Promise<void>;
}

/**
 * InterpreterGroups component.
 * @param props A InterpreterGroupsProps that contains the component properties.
 * @returns The rendered component.
 */
export const InterpreterGroups = (props: InterpreterGroupsProps) => {
	// State hooks.
	const [interpreterGroups, setInterpreterGroups] =
		useState(createInterpreterGroups(
			props.languageRuntimeService,
			props.runtimeAffiliationService));

	// Main useEffect hook.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add our onDidRegisterRuntime event handler. This allows the set of runtimes to be dynamic
		// at app startup.
		disposableStore.add(props.languageRuntimeService.onDidRegisterRuntime(() => {
			setInterpreterGroups(
				createInterpreterGroups(
					props.languageRuntimeService,
					props.runtimeAffiliationService));
		}));

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, [props.languageRuntimeService, props.runtimeAffiliationService]);

	// Render.
	return (
		<div className='interpreter-groups'>
			{interpreterGroups.map((interpreterGroup, index, runningRuntimes) => (
				<InterpreterGroup
					key={interpreterGroup.primaryRuntime.runtimeId}
					interpreterGroup={interpreterGroup}
					languageRuntimeService={props.languageRuntimeService}
					runtimeSessionService={props.runtimeSessionService}
					onActivateRuntime={props.onActivateRuntime}
					onStartRuntime={props.onStartRuntime}
				/>
			))}
		</div>
	);
};
