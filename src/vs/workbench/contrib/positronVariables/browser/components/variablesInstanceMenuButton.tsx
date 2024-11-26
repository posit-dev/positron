/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './variablesInstanceMenuButton.css';
import * as React from 'react';
import { IAction } from '../../../../../base/common/actions.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ActionBarMenuButton } from '../../../../../platform/positronActionBar/browser/components/actionBarMenuButton.js';
import { ILanguageRuntimeSession } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { usePositronVariablesContext } from '../positronVariablesContext.js';
import { LanguageRuntimeSessionMode } from '../../../../services/languageRuntime/common/languageRuntimeService.js';

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
