/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./variablesInstanceMenuButton';
import * as React from 'react';
import { IAction } from 'vs/base/common/actions';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { ILanguageRuntime } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { ActionBarMenuButton } from 'vs/platform/positronActionBar/browser/components/actionBarMenuButton';
import { usePositronVariablesContext } from 'vs/workbench/contrib/positronVariables/browser/positronVariablesContext';

/**
 * VariablesInstanceMenuButton component.
 * @returns The rendered component.
 */
export const VariablesInstanceMenuButton = () => {
	// Context hooks.
	const positronVariablesContext = usePositronVariablesContext();

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
			positronVariablesContext.activePositronVariablesInstance?.runtime));

	// useEffect hook to update the runtime label.
	React.useEffect(() => {
		const disposables = new DisposableStore();
		const variablesService = positronVariablesContext.positronVariablesService;
		disposables.add(variablesService.onDidChangeActivePositronVariablesInstance(e => {
			setActiveRuntimeLabel(labelForRuntime(e?.runtime));
		}));
		return () => disposables.dispose();
	}, [positronVariablesContext.activePositronVariablesInstance]);

	// Builds the actions.
	const actions = () => {
		// Build the actions.
		const actions: IAction[] = [];
		positronVariablesContext.positronVariablesInstances.map(positronVariablesInstance => {
			actions.push({
				id: positronVariablesInstance.runtime.metadata.runtimeId,
				label: positronVariablesInstance.runtime.metadata.runtimeName,
				tooltip: '',
				class: undefined,
				enabled: true,
				run: () => {
					positronVariablesContext.languageRuntimeService.activeRuntime =
						positronVariablesInstance.runtime;
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
