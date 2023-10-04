/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./environmentInstanceMenuButton';
import * as React from 'react';
import { IAction } from 'vs/base/common/actions';
import { ActionBarMenuButton } from 'vs/platform/positronActionBar/browser/components/actionBarMenuButton';
import { usePositronEnvironmentContext } from 'vs/workbench/contrib/positronEnvironment/browser/positronEnvironmentContext';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { ILanguageRuntime } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

/**
 * EnvironmentInstanceMenuButton component.
 * @returns The rendered component.
 */
export const EnvironmentInstanceMenuButton = () => {
	// Context hooks.
	const positronEnvironmentContext = usePositronEnvironmentContext();

	// Helper method to calculate the label for a runtime.
	const labelForRuntime = (runtime?: ILanguageRuntime): string => {
		if (runtime) {
			return runtime.metadata.runtimeName;
		}
		return 'None';
	};

	// State.
	const [activeRuntimeLabel, setActiveRuntimeLabel] =
		React.useState(labelForRuntime(
			positronEnvironmentContext.activePositronEnvironmentInstance?.runtime));

	// useEffect hook to update the runtime label when the environment changes.
	React.useEffect(() => {
		const disposables = new DisposableStore();
		const environmentService = positronEnvironmentContext.positronEnvironmentService;
		disposables.add(environmentService.onDidChangeActivePositronEnvironmentInstance(e => {
			setActiveRuntimeLabel(labelForRuntime(e?.runtime));
		}));
		return () => disposables.dispose();
	}, [positronEnvironmentContext.activePositronEnvironmentInstance]);

	// Builds the actions.
	const actions = () => {
		// Build the actions for the available language environments.
		const actions: IAction[] = [];
		positronEnvironmentContext.positronEnvironmentInstances.map(positronEnvironmentInstance => {
			actions.push({
				id: positronEnvironmentInstance.runtime.metadata.runtimeId,
				label: positronEnvironmentInstance.runtime.metadata.runtimeName,
				tooltip: '',
				class: undefined,
				enabled: true,
				run: () => {
					positronEnvironmentContext.languageRuntimeService.activeRuntime =
						positronEnvironmentInstance.runtime;
				}
			});
		});

		// Done. Return the actions.
		return actions;
	};

	// Render.
	return (
		<ActionBarMenuButton
			text={activeRuntimeLabel}
			actions={actions}
		/>
	);
};
