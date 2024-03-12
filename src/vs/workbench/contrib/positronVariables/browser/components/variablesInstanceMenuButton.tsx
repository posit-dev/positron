/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./variablesInstanceMenuButton';
import * as React from 'react';
import { IAction } from 'vs/base/common/actions';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { ActionBarMenuButton } from 'vs/platform/positronActionBar/browser/components/actionBarMenuButton';
import { ILanguageRuntimeSession } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';
import { usePositronVariablesContext } from 'vs/workbench/contrib/positronVariables/browser/positronVariablesContext';
import { LanguageRuntimeSessionMode } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

/**
 * VariablesInstanceMenuButton component.
 * @returns The rendered component.
 */
export const VariablesInstanceMenuButton = () => {
	// Context hooks.
	const positronVariablesContext = usePositronVariablesContext();

	// Helper method to calculate the label for a runtime.
	const labelForRuntime = (session?: ILanguageRuntimeSession): string => {
		if (session) {
			return session.metadata.sessionName;
		}
		return 'None';
	};

	// State.
	const [activeRuntimeLabel, setActiveRuntimeLabel] =
		React.useState(labelForRuntime(
			positronVariablesContext.activePositronVariablesInstance?.session));

	// useEffect hook to update the runtime label.
	React.useEffect(() => {
		const disposables = new DisposableStore();
		const variablesService = positronVariablesContext.positronVariablesService;
		disposables.add(variablesService.onDidChangeActivePositronVariablesInstance(e => {
			setActiveRuntimeLabel(labelForRuntime(e?.session));
		}));
		return () => disposables.dispose();
	}, [positronVariablesContext.activePositronVariablesInstance]);

	// Builds the actions.
	const actions = () => {
		// Build the actions.
		const actions: IAction[] = [];
		positronVariablesContext.positronVariablesInstances.map(positronVariablesInstance => {
			actions.push({
				id: positronVariablesInstance.session.sessionId,
				label: positronVariablesInstance.session.metadata.sessionName,
				tooltip: '',
				class: undefined,
				enabled: true,
				run: () => {
					// Set the active variables session to the one the user selected.
					const session = positronVariablesInstance.session;
					positronVariablesContext.positronVariablesService
						.setActivePositronVariablesSession(session.sessionId);

					// If this is a console session, set it as the foreground
					// session, too, so that the rest of the UI can pick it up.
					if (session.metadata.sessionMode === LanguageRuntimeSessionMode.Console) {
						positronVariablesContext.runtimeSessionService.foregroundSession =
							positronVariablesInstance.session;
					}
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
