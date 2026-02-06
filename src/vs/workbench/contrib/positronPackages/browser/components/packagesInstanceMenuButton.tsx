/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React, { useState, useEffect } from 'react';

// Other dependencies.
import { IAction } from '../../../../../base/common/actions.js';
import { ActionBarMenuButton } from '../../../../../platform/positronActionBar/browser/components/actionBarMenuButton.js';
import { ILanguageRuntimeSession } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { usePositronPackagesContext } from '../positronPackagesContext.js';
import { LanguageRuntimeSessionMode } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { localize } from '../../../../../nls.js';

// Helper method to calculate the label for a runtime.
const labelForRuntime = (session?: ILanguageRuntimeSession): string => {
	if (session) {
		return session.getLabel();
	}
	return localize('none', 'None');
};

/**
 * PackagesInstanceMenuButton component.
 * @returns The rendered component.
 */
export const PackagesInstanceMenuButton = () => {
	// Context hooks.
	const services = usePositronReactServicesContext();
	const { activeInstance, instances } = usePositronPackagesContext();

	// Store just the label in state instead of the entire session
	const [sessionLabel, setSessionLabel] = useState<string>(
		labelForRuntime(activeInstance?.session)
	);

	// Use an effect to update the session label when active instance changes
	useEffect(() => {
		const disposables = new DisposableStore();

		// Update label when active instance changes
		disposables.add(services.positronPackagesService.onDidChangeActivePackagesInstance(instance => {
			setSessionLabel(labelForRuntime(instance?.session));
		}));

		// Update label when active instance's session name changes
		disposables.add(services.runtimeSessionService.onDidUpdateSessionName(session => {
			if (session.sessionId === activeInstance?.session.sessionId) {
				setSessionLabel(labelForRuntime(session));
			}
		}));

		return () => disposables.dispose();
	}, [services.positronPackagesService, services.runtimeSessionService, activeInstance]);

	// Builds the actions.
	const actions = (): IAction[] => {
		return instances.map(instance => {
			return {
				id: instance.session.sessionId,
				label: labelForRuntime(instance.session),
				tooltip: '',
				class: undefined,
				enabled: true,
				run: () => {
					// Set the active packages session to the one the user selected.
					const session = instance.session;
					services.positronPackagesService.setActivePositronPackagesSession(session)

					// If this is a console session, set it as the foreground
					// session, too, so that the rest of the UI can pick it up.
					if (session.metadata.sessionMode === LanguageRuntimeSessionMode.Console) {
						services.runtimeSessionService.foregroundSession =
							instance.session;
					}
				}
			};
		});
	};

	// Render.
	return (
		<ActionBarMenuButton
			actions={actions}
			label={sessionLabel}
		/>
	);
};
