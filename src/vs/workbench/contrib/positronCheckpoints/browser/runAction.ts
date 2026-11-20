/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { ICheckpointsService } from '../../../services/positronCheckpoints/common/checkpointsService.js';
import { ICheckpointsEngineProxy, ICollisionChoice, OperationResult } from '../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { guardUnsavedEditors, UnsavedEditorsDecision, UnsavedEditorsMode } from '../../../services/positronCheckpoints/browser/unsavedEditorsGuard.js';
import { Strings } from '../common/checkpointsStrings.js';
import { ICheckpointsMessageService } from './checkpointsMessages.js';
import { showCheckResultDialog } from './components/checkResultDialog.js';
import { showCollisionDialog } from './components/collisionDialog.js';
import { IDialogActions } from './components/dialogActions.js';
import { showInterruptedDialog } from './components/interruptedDialog.js';
import { OverlapEditorInput } from './overlapEditor/overlapEditorInput.js';
import { projectRootUri } from './projectRoot.js';
import { ISyncController } from './syncController.js';

/**
 * How an action treats files with unsaved edits. `checkpoint` and `file-changing` ask first (spec
 * 5.5); `no-guard` is for actions that neither read nor write files in the project.
 */
export type RunActionMode = UnsavedEditorsMode | 'no-guard';

/**
 * The actions of the dialogs that `routeResult` opens, and that the view opens from state. A
 * dialog runs its engine calls through `runAction`, so their results are routed too. A change to
 * the project made outside `runAction`, such as the removal of a recovery snapshot, is reported
 * through `ICheckpointsService.reportStateChanged`, so every view reads the state again.
 */
export function createDialogActions(instantiationService: IInstantiationService): IDialogActions {
	return {
		run: (mode, call) => instantiationService.invokeFunction(accessor => runAction(accessor, mode, call)),
		removeRecoverySnapshot: async operationId => {
			const { checkpointsService, messageService, logService } = instantiationService.invokeFunction(accessor => ({
				checkpointsService: accessor.get(ICheckpointsService),
				messageService: accessor.get(ICheckpointsMessageService),
				logService: accessor.get(ILogService),
			}));
			try {
				await checkpointsService.engine?.removeRecoverySnapshot(operationId);
				checkpointsService.reportStateChanged();
				return true;
			} catch (error) {
				logService.error('The recovery snapshot could not be removed.', error);
				messageService.show(Strings.results.couldNotFinish());
				return false;
			}
		},
	};
}

/**
 * Shows the outcome of an action in the view. Every result kind publishes its sentence on the
 * status line of the view; a plain success empties the line. Overlaps also open the overlap
 * editor, and so do changed inputs that still have overlaps to review. An interrupted action
 * opens the interrupted-action dialog, and a project check result opens the check result dialog.
 * Nothing becomes a notification.
 */
async function routeResult(
	messageService: ICheckpointsMessageService,
	instantiationService: IInstantiationService,
	logService: ILogService,
	engine: ICheckpointsEngineProxy,
	result: OperationResult,
	options: IRunActionOptions
): Promise<void> {
	switch (result.kind) {
		case 'overlaps':
		case 'inputs-changed':
			messageService.show(Strings.results.forOperation(result));
			if (result.preview.overlaps.length > 0) {
				try {
					const editorService = instantiationService.invokeFunction(accessor => accessor.get(IEditorService));
					// A window has one overlap editor, so an open one is shown again.
					const open = editorService.editors.find(editor => editor instanceof OverlapEditorInput);
					if (open) {
						await editorService.openEditor(open, { pinned: true });
					} else {
						// Closing the editor forgets the choices made in it, which would otherwise keep
						// the sync card from reading the incoming changes again.
						const syncController = instantiationService.invokeFunction(accessor => accessor.get(ISyncController));
						const input = new OverlapEditorInput(() => syncController.backOut());
						try {
							await editorService.openEditor(input, { pinned: true });
						} catch (error) {
							input.dispose();
							throw error;
						}
					}
				} catch (error) {
					logService.error('The overlap editor could not open.', error);
				}
			}
			return;
		case 'interrupted':
			messageService.show(Strings.results.forOperation(result));
			try {
				const state = await engine.getState();
				if (state.interrupted) {
					showInterruptedDialog(state.interrupted, state.recoverySnapshots, createDialogActions(instantiationService));
				}
			} catch (error) {
				logService.error('The interrupted-action dialog could not open.', error);
			}
			return;
		case 'check-failed':
		case 'check-changed-checkpoint':
			messageService.show(Strings.results.forOperation(result));
			try {
				showCheckResultDialog(result, createDialogActions(instantiationService), options.chunkCount);
			} catch (error) {
				logService.error('The project check dialog could not open.', error);
			}
			return;
		case 'done':
		case 'path-collisions':
		case 'changes-moved':
		case 'project-changed':
		case 'rejected':
		case 'could-not-finish':
		case 'unavailable':
			messageService.show(Strings.results.forOperation(result));
			return;
	}
}

/** Adds the choices of `added` to `choices`, replacing an earlier choice for the same path. */
export function mergeCollisionChoices(choices: readonly ICollisionChoice[], added: readonly ICollisionChoice[]): ICollisionChoice[] {
	const byPath = new Map(choices.map(choice => [choice.path, choice]));
	for (const choice of added) {
		byPath.set(choice.path, choice);
	}
	return [...byPath.values()];
}

/** The paths of `collisions`, sorted, as one value that compares with `===`. */
function collisionPaths(collisions: readonly { path: string }[]): string {
	return JSON.stringify(collisions.map(collision => collision.path).sort());
}

/**
 * What the guard decided, as `call` receives it. It is set in `checkpoint` mode only, so that a
 * caller can compute its chunks again after a save, and is undefined in the other modes.
 */
export type RunActionDecision = Exclude<UnsavedEditorsDecision, 'cancel'> | undefined;

/** What `call` receives besides the engine. */
export interface IRunActionContext {
	/** What the guard decided. */
	decision: RunActionDecision;
	/**
	 * What to do with each file the action would replace that is in no checkpoint. Empty on the
	 * first call; after the person answers the collision dialog, the call runs again with them.
	 */
	collisionChoices: ICollisionChoice[];
}

/** What `runAction` needs to know about an action besides its call. */
export interface IRunActionOptions {
	/**
	 * The number of checkpoints the action asks the engine to create, so that the dialog of a
	 * project check result can say which of them was not created.
	 */
	chunkCount?: number;
}

/**
 * The engine call of an action. It returns undefined when it decides not to call the engine, for
 * example because a save changed what the person reviewed.
 */
export type RunActionCall = (engine: ICheckpointsEngineProxy, context: IRunActionContext) => Promise<OperationResult | undefined>;

/**
 * Runs one action of the Checkpoints view: asks about unsaved editors (unless `mode` is
 * `no-guard`), calls the engine, and shows the result in the view. When the engine reports files
 * that the action would replace and that are in no checkpoint, the collision dialog asks what to
 * do, and `call` runs again with the chosen collision choices. When the engine then reports the
 * same files again, the action stops with the collision sentence instead of asking again.
 *
 * @returns The engine's result, or undefined when no engine is registered, the person cancelled
 * at the unsaved-editors question or the collision dialog, `call` did not call the engine, or the
 * engine call threw. A thrown error is logged and the view says the action could not finish.
 */
export async function runAction(
	accessor: ServicesAccessor,
	mode: RunActionMode,
	call: RunActionCall,
	options: IRunActionOptions = {}
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
		let projectRoot: URI;
		try {
			projectRoot = projectRootUri(workspaceContextService, (await engine.getState()).projectRoot);
		} catch (error) {
			logService.error('The state of the project could not be read before the action.', error);
			messageService.show(Strings.results.couldNotFinish());
			return undefined;
		}
		const guarded = await instantiationService.invokeFunction(guardAccessor => guardUnsavedEditors(guardAccessor, projectRoot, mode));
		if (guarded === 'cancel') {
			return undefined;
		}
		if (mode === 'checkpoint') {
			decision = guarded;
		}
	}

	let collisionChoices: ICollisionChoice[] = [];
	// The paths of the collisions the person answered last, to tell a repeated answer apart.
	let answeredPaths: string | undefined;
	for (; ;) {
		let result: OperationResult | undefined;
		try {
			result = await call(engine, { decision, collisionChoices });
		} catch (error) {
			logService.error('The checkpoints engine call failed.', error);
			messageService.show(Strings.results.couldNotFinish());
			return undefined;
		}
		if (!result) {
			return undefined;
		}
		if (result.kind === 'path-collisions') {
			const paths = collisionPaths(result.collisions);
			if (paths === answeredPaths) {
				// The engine reports the same files after the person answered for them, so asking
				// again would loop. The action stops with the sentence for collisions.
				messageService.show(Strings.results.forOperation(result));
				return result;
			}
			answeredPaths = paths;
			const chosen = await showCollisionDialog(result.collisions);
			if (!chosen) {
				messageService.show(Strings.collisions.cancelled());
				return undefined;
			}
			collisionChoices = mergeCollisionChoices(collisionChoices, chosen);
			continue;
		}
		await routeResult(messageService, instantiationService, logService, engine, result, options);
		return result;
	}
}
