/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { useNotebookInstance } from '../../NotebookInstanceProvider.js';
import { GhostCellController } from './controller.js';

/**
 * Hook to access the GhostCellController contribution from the current notebook instance.
 * Must be used within a NotebookInstanceProvider.
 */
export function useGhostCellController(): GhostCellController {
	const instance = useNotebookInstance();
	const controller = GhostCellController.get(instance);
	if (!controller) {
		throw new Error('GhostCellController not found. Ensure the contribution is registered.');
	}
	return controller;
}
