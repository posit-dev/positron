/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { useEffect, useState } from 'react';

// Other dependencies.
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { ActionBarButton } from '../../../../../platform/positronActionBar/browser/components/actionBarButton.js';
import { ILanguageRuntimeSession } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { usePositronPackagesContext } from '../positronPackagesContext.js';

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
	const { activeInstance } = usePositronPackagesContext();

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

	// Render.
	return (
		<ActionBarButton
			label={sessionLabel}
		/>
	);
};
