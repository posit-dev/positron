/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { useEffect, useState } from 'react';

// Other dependencies.
import { usePositronReactServicesContext } from '../../../../base/browser/positronReactRendererContext.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { PositronPackagesEnvironment } from './positronPackagesContext.js';
import { IPositronPackagesInstance } from './positronPackagesInstance.js';

/**
 * PositronPackagesState interface.
 */
export interface PositronPackagesState extends PositronPackagesEnvironment {
	readonly activeInstance?: IPositronPackagesInstance;
	readonly instances: IPositronPackagesInstance[];
}

/**
 * The usePositronPackagesState custom hook.
 * @returns The hook.
 */
export const usePositronPackagesState = (
	positronPackagesEnvironment: PositronPackagesEnvironment,
): PositronPackagesState => {
	// Hooks.
	const services = usePositronReactServicesContext();
	const [instances, setInstances] = useState<IPositronPackagesInstance[]>([]);
	const [instance, setInstance] = useState<IPositronPackagesInstance>();

	// When the active session changes
	useEffect(() => {
		const disposableStore = new DisposableStore();
		disposableStore.add(
			services.positronPackagesService.onDidChangeActivePackagesInstance((instance) => {
				setInstances(services.positronPackagesService.getInstances())
				setInstance(instance)
			})
		)

		disposableStore.add(
			services.positronPackagesService.onDidStopPackagesInstance(() => {
				setInstances(services.positronPackagesService.getInstances())
			})
		)
		return () => disposableStore.dispose();
	}, [
		services.positronPackagesService,
	]);

	// Return the Positron Packages state.
	return {
		...positronPackagesEnvironment,
		activeInstance: instance,
		instances,
	};
};
