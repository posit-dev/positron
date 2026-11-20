/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { ICheckpointsService } from '../../../services/positronCheckpoints/common/checkpointsService.js';
import { ICheckpointsEngineProxy, OperationResult } from '../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { guardUnsavedEditors, UnsavedEditorsDecision, UnsavedEditorsMode } from '../../../services/positronCheckpoints/browser/unsavedEditorsGuard.js';
import { Strings } from '../common/checkpointsStrings.js';
import { ICheckpointsMessageService } from './checkpointsMessages.js';

/**
 * How an action treats files with unsaved edits. `checkpoint` and `file-changing` ask first (spec
 * 5.5); `no-guard` is for actions that neither read nor write files in the project.
 */
export type RunActionMode = UnsavedEditorsMode | 'no-guard';

/**
 * The URI of the engine's project root, with the scheme and authority of the workspace, so that
 * it compares equal to the resources of the editors open in a remote window.
 */
export function projectRootUri(workspaceContextService: IWorkspaceContextService, projectRoot: string): URI {
	const path = URI.file(projectRoot).path;
	const folder = workspaceContextService.getWorkspace().folders[0];
	return folder ? folder.uri.with({ path }) : URI.file(projectRoot);
}

/**
 * Shows the outcome of an action in the view. Every result kind shows its sentence on the status
 * line of the view; a plain success empties the line.
 */
function routeResult(messageService: ICheckpointsMessageService, result: OperationResult): void {
	switch (result.kind) {
		case 'done':
		case 'check-failed':
		case 'check-changed-checkpoint':
		case 'path-collisions':
		case 'overlaps':
		case 'inputs-changed':
		case 'changes-moved':
		case 'project-changed':
		case 'rejected':
		case 'could-not-finish':
		case 'interrupted':
		case 'unavailable':
			messageService.show(Strings.results.forOperation(result));
			return;
	}
}

/**
 * What the guard decided, as `call` receives it. It is set in `checkpoint` mode only, so that a
 * caller can compute its chunks again after a save, and is undefined in the other modes.
 */
export type RunActionDecision = Exclude<UnsavedEditorsDecision, 'cancel'> | undefined;

/** The engine call of an action. */
export type RunActionCall = (engine: ICheckpointsEngineProxy, decision: RunActionDecision) => Promise<OperationResult>;

/**
 * Runs one action of the Checkpoints view: asks about unsaved editors (unless `mode` is
 * `no-guard`), calls the engine, and shows the result in the view.
 *
 * @returns The engine's result, or undefined when no engine is registered, the person cancelled
 * at the unsaved-editors question, or the engine call threw. A thrown error is logged and the view
 * says the action could not finish.
 */
export async function runAction(
	accessor: ServicesAccessor,
	mode: RunActionMode,
	call: RunActionCall
): Promise<OperationResult | undefined> {
	// An accessor is valid only until the first await, so every service is read here.
	const checkpointsService = accessor.get(ICheckpointsService);
	const messageService = accessor.get(ICheckpointsMessageService);
	const workspaceContextService = accessor.get(IWorkspaceContextService);
	const instantiationService = accessor.get(IInstantiationService);
	const logService = accessor.get(ILogService);

	const engine = checkpointsService.engine;
	if (!engine) {
		messageService.show(Strings.status.noEngine());
		return undefined;
	}

	let decision: RunActionDecision;
	if (mode !== 'no-guard') {
		const state = await engine.getState();
		const projectRoot = projectRootUri(workspaceContextService, state.projectRoot);
		const guarded = await instantiationService.invokeFunction(guardAccessor => guardUnsavedEditors(guardAccessor, projectRoot, mode));
		if (guarded === 'cancel') {
			return undefined;
		}
		if (mode === 'checkpoint') {
			decision = guarded;
		}
	}

	let result: OperationResult;
	try {
		result = await call(engine, decision);
	} catch (error) {
		logService.error('The checkpoints engine call failed.', error);
		messageService.show(Strings.results.couldNotFinish());
		return undefined;
	}
	routeResult(messageService, result);
	return result;
}
