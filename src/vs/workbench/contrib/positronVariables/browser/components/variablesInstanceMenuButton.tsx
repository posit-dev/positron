/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './variablesInstanceMenuButton.css';

// React.
import React, { useState, useEffect } from 'react';

// Other dependencies.
import { IAction } from '../../../../../base/common/actions.js';
import { ActionBarMenuButton } from '../../../../../platform/positronActionBar/browser/components/actionBarMenuButton.js';
import { ILanguageRuntimeSession } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { usePositronVariablesContext } from '../positronVariablesContext.js';
import { LanguageRuntimeSessionMode } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';

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
			return session.getLabel();
		}
		return 'None';
	};

	// Store just the label in state instead of the entire session
	const [sessionLabel, setSessionLabel] = useState<string>(
		labelForRuntime(positronVariablesContext.activePositronVariablesInstance?.session)
	);

	// Use an effect to update the session label when active instance changes
	useEffect(() => {
		const disposables = new DisposableStore();

		// Update label when active instance changes
		disposables.add(positronVariablesContext.positronVariablesService.onDidChangeActivePositronVariablesInstance(instance => {
			setSessionLabel(labelForRuntime(instance?.session));
		}));

		return () => disposables.dispose();
	}, [positronVariablesContext.positronVariablesService, positronVariablesContext.runtimeSessionService, positronVariablesContext.activePositronVariablesInstance]);

	// Builds the actions.
	const actions = () => {
		// Build the actions.
		const actions: IAction[] = [];
		positronVariablesContext.positronVariablesInstances.map(positronVariablesInstance => {
			actions.push({
				id: positronVariablesInstance.session.sessionId,
				label: labelForRuntime(positronVariablesInstance.session),
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
			actions={actions}
			text={sessionLabel}
		/>
	);
};
