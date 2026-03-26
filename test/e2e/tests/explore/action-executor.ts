/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Application } from '../../infra/application';
import { actionCatalog } from './action-catalog';
import { observeState } from './observer';
import { ActionRequest, ActionResult } from './types';

/**
 * Execute a single action request: look up in catalog, run, time, observe state.
 */
export async function executeAction(app: Application, request: ActionRequest): Promise<ActionResult> {
	const start = Date.now();

	const handler = actionCatalog[request.action];
	if (!handler) {
		const state = await observeState(app);
		return {
			success: false,
			error: `Unknown action: ${request.action}. Available: ${Object.keys(actionCatalog).join(', ')}`,
			state,
			duration: Date.now() - start,
		};
	}

	try {
		const result = await handler(app, request.params ?? {});
		const state = await observeState(app);
		return {
			success: true,
			result,
			state,
			duration: Date.now() - start,
		};
	} catch (err: any) {
		const state = await observeState(app);
		return {
			success: false,
			error: err.message ?? String(err),
			state,
			duration: Date.now() - start,
		};
	}
}
