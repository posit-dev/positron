/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { useCallback, useEffect, useState } from "react";

// Other dependencies.
import { LanguageRuntimePackage } from "positron";
import { usePositronReactServicesContext } from "../../../../base/browser/positronReactRendererContext.js";
import { DisposableStore } from "../../../../base/common/lifecycle.js";
import { ILanguageRuntimeSession } from "../../../services/runtimeSession/common/runtimeSessionService.js";
import { PositronPackagesEnvironment } from "./positronPackagesContext.js";

export interface IPositronPackagesInstance {
	id: string;
	name: string;
}

/**
 * PositronPackagesState interface.
 */
export interface PositronPackagesState extends PositronPackagesEnvironment {
	readonly packages: Record<string, LanguageRuntimePackage[]>;
	readonly activeSessionId?: string;
	readonly activeSession?: ILanguageRuntimeSession;
	refreshPackages(sessionId: string): Promise<void>;
}

/**
 * The usePositronPackagesState custom hook.
 * @returns The hook.
 */
export const usePositronPackagesState = (
	positronPackagesEnvironment: PositronPackagesEnvironment
): PositronPackagesState => {
	// Hooks.
	const services = usePositronReactServicesContext();
	const [packages, setPackages] = useState<
		Record<string, LanguageRuntimePackage[]>
	>({});

	const defaultSession = services.runtimeSessionService.activeSessions[0];
	const [activeSessionId, setActiveSessionId] = useState<string | undefined>(
		defaultSession?.metadata.sessionId
	);
	const [activeSession, setActiveSession] = useState<
		ILanguageRuntimeSession | undefined
	>(defaultSession);

	const refreshPackages = useCallback(
		async (sessionId: string) => {
			// Clear out any existing packages for this session.
			setPackages((packages) => ({ ...packages, [sessionId]: [] }));

			const session = services.runtimeSessionService.getSession(sessionId);
			if (session) {
				try {
					const list = await session.getPackages();
					setPackages((packages) => ({
						...packages,
						[sessionId]: [...list],
					}));
				} catch (_error) {
					setPackages((packages) => ({ ...packages, [sessionId]: [] }));
				}
			}
		},
		[services.runtimeSessionService]
	);

	// When the active session changes
	useEffect(() => {
		const disposableStore = new DisposableStore();
		disposableStore.add(
			services.runtimeSessionService.onWillStartSession(
				({ session, activate }) => {
					if (activate) {
						setActiveSessionId(session.metadata.sessionId);
						setActiveSession(session);
						refreshPackages(session.metadata.sessionId);
					}
				}
			)
		);
		disposableStore.add(
			services.runtimeSessionService.onDidChangeForegroundSession((session) => {
				setActiveSessionId(session?.metadata.sessionId);
				setActiveSession(session);
				if (session) {
					refreshPackages(session.metadata.sessionId);
				}
			})
		);
		return () => disposableStore.dispose();
	}, [
		setActiveSessionId,
		services.positronConnectionsService,
		services.runtimeSessionService,
		refreshPackages,
	]);

	// Add event handlers.
	useEffect(() => {
		// Create a disposable store for the event handlers we'll add.
		const disposableStore = new DisposableStore();

		// Return the clean up for our event handlers.
		return () => disposableStore.dispose();
	});

	// Return the Positron Packages state.
	return {
		...positronPackagesEnvironment,
		activeSessionId,
		activeSession,
		packages,
		refreshPackages,
	};
};
