/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import "./variablesInstanceMenuButton.css";

// React.
import React, { useEffect, useState } from "react";

// Other dependencies.
import { usePositronReactServicesContext } from "../../../../../base/browser/positronReactRendererContext.js";
import { IAction } from "../../../../../base/common/actions.js";
import { DisposableStore } from "../../../../../base/common/lifecycle.js";
import { ActionBarMenuButton } from "../../../../../platform/positronActionBar/browser/components/actionBarMenuButton.js";
import { ILanguageRuntimeSession } from "../../../../services/runtimeSession/common/runtimeSessionService.js";
import { usePositronPackagesContext } from "../positronPackagesContext.js";

/**
 * VariablesInstanceMenuButton component.
 * @returns The rendered component.
 */
export const PackagesSessionInstanceMenuButton = () => {
	// Context hooks.
	const services = usePositronReactServicesContext();
	const positronPackagesContext = usePositronPackagesContext();

	// Helper method to calculate the label for a runtime.
	const labelForRuntime = (session?: ILanguageRuntimeSession): string => {
		if (session) {
			return session.getLabel();
		}
		return "None";
	};

	// Store just the label in state instead of the entire session
	const [sessionLabel, setSessionLabel] = useState<string>(
		labelForRuntime(positronPackagesContext.activeSession)
	);

	// Use an effect to update the session label when active instance changes
	useEffect(() => {
		const disposables = new DisposableStore();

		// Update label when active instance changes
		disposables.add(
			services.positronVariablesService.onDidChangeActivePositronVariablesInstance(
				(instance) => {
					setSessionLabel(labelForRuntime(instance?.session));
				}
			)
		);

		disposables.add(
			services.runtimeSessionService.onDidUpdateSessionName((session) => {
				if (session.sessionId === positronPackagesContext.activeSessionId) {
					setSessionLabel(labelForRuntime(session));
				}
			})
		);

		return () => disposables.dispose();
	}, [
		services.positronVariablesService,
		services.runtimeSessionService,
		positronPackagesContext.activeSessionId,
	]);

	// Builds the actions.
	const actions = () => {
		// Build the actions.
		const actions: IAction[] = [];
		// Done. Return the actions.
		return actions;
	};

	// Render.
	return <ActionBarMenuButton actions={actions} label={sessionLabel} />;
};
