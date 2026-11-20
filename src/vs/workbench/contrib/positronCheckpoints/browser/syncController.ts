/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator, IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ICheckpointsService } from '../../../services/positronCheckpoints/common/checkpointsService.js';
import { ICollisionChoice, IIncomingPreview, IResolution, OperationResult, OverlapChoice, OverlapKind } from '../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { Strings } from '../common/checkpointsStrings.js';
import { ICheckpointsMessageService } from './checkpointsMessages.js';
import { mergeCollisionChoices, runAction } from './runAction.js';

/** The choices the engine accepts for each kind of overlap (spec 6.4). */
export const ALLOWED_CHOICES: Record<OverlapKind, readonly OverlapChoice['type'][]> = {
	'text': ['text', 'take'],
	'binary': ['take', 'keep-both'],
	'edit-delete': ['keep-file', 'accept-deletion'],
	'rename': ['path'],
	'file-folder': ['keep-both', 'take'],
	'unsupported': [],
};

/** An `inputs-changed` result: what changed since the person reviewed the overlaps. */
export type InputsChangedResult = OperationResult & { kind: 'inputs-changed' };

export const ISyncController = createDecorator<ISyncController>('positronCheckpointsSyncController');

/**
 * Getting colleagues' changes, for the sync card and the overlap editor of one window. It keeps
 * the preview of the incoming changes, the person's choice for each overlap, and the collision
 * choices of the current attempt. React components only render it.
 */
export interface ISyncController {
	readonly _serviceBrand: undefined;

	/** The incoming changes as last previewed, or undefined before the first preview. */
	readonly preview: IIncomingPreview | undefined;

	/** The chosen resolution of each overlap, by overlap id. */
	readonly resolutions: ReadonlyMap<string, OverlapChoice>;

	/** The collision choices the person made during the current attempt. */
	readonly collisionChoices: readonly ICollisionChoice[];

	/** Set when the last attempt was refused because its inputs changed; says what changed. */
	readonly inputsChanged: InputsChangedResult | undefined;

	/** True when the preview has an overlap that only a git tool can resolve. */
	readonly hasUnsupported: boolean;

	/** True when every overlap has a choice and none needs a git tool. */
	readonly canApply: boolean;

	/** Fires when any of the values above changes. */
	readonly onDidChange: Event<void>;

	/**
	 * Reads the preview again. A failed read keeps the previous preview. While the person has made
	 * any overlap choice, the preview they reviewed is kept, so that the engine compares the
	 * choices with what was reviewed and reports any change.
	 */
	refreshPreview(): Promise<void>;

	/**
	 * Gets the incoming changes without any overlap choice. When they overlap with the person's
	 * work, the engine changes nothing and the overlap editor opens.
	 */
	getChanges(): Promise<OperationResult | undefined>;

	/**
	 * Sets or clears the choice for one overlap. A choice the kind does not allow, or an overlap
	 * that is not in the preview, changes nothing.
	 */
	setChoice(overlapId: string, choice: OverlapChoice | undefined): void;

	/** Gets the incoming changes with the chosen resolutions. Does nothing unless `canApply`. */
	apply(): Promise<OperationResult | undefined>;

	/** Forgets every choice. The project is not touched. */
	backOut(): void;
}

export class SyncController extends Disposable implements ISyncController {
	declare readonly _serviceBrand: undefined;

	private _preview: IIncomingPreview | undefined;
	private readonly _resolutions = new Map<string, OverlapChoice>();
	private _collisionChoices: ICollisionChoice[] = [];
	private _inputsChanged: InputsChangedResult | undefined;

	/** Counts preview reads, so that the answer of a superseded read is dropped. */
	private _previewRequest = 0;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;

	constructor(
		@ICheckpointsService private readonly _checkpointsService: ICheckpointsService,
		@ICheckpointsMessageService private readonly _messageService: ICheckpointsMessageService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();
	}

	get preview(): IIncomingPreview | undefined {
		return this._preview;
	}

	get resolutions(): ReadonlyMap<string, OverlapChoice> {
		return this._resolutions;
	}

	get collisionChoices(): readonly ICollisionChoice[] {
		return this._collisionChoices;
	}

	get inputsChanged(): InputsChangedResult | undefined {
		return this._inputsChanged;
	}

	get hasUnsupported(): boolean {
		return this._preview?.overlaps.some(overlap => overlap.kind === 'unsupported') ?? false;
	}

	get canApply(): boolean {
		return this._preview !== undefined
			&& !this.hasUnsupported
			&& this._preview.overlaps.every(overlap => this._resolutions.has(overlap.id));
	}

	async refreshPreview(): Promise<void> {
		const request = ++this._previewRequest;
		const engine = this._checkpointsService.engine;
		if (!engine) {
			return;
		}
		let preview: IIncomingPreview;
		try {
			preview = await engine.previewIncoming();
		} catch (error) {
			this._logService.error('The incoming changes could not be read.', error);
			return;
		}
		if (request === this._previewRequest && this._resolutions.size === 0) {
			this._setPreview(preview);
			this._onDidChange.fire();
		}
	}

	getChanges(): Promise<OperationResult | undefined> {
		return this._run([]);
	}

	setChoice(overlapId: string, choice: OverlapChoice | undefined): void {
		const overlap = this._preview?.overlaps.find(candidate => candidate.id === overlapId);
		if (!overlap) {
			return;
		}
		if (choice === undefined) {
			this._resolutions.delete(overlapId);
		} else if (ALLOWED_CHOICES[overlap.kind].includes(choice.type)) {
			this._resolutions.set(overlapId, choice);
		} else {
			return;
		}
		this._onDidChange.fire();
	}

	async apply(): Promise<OperationResult | undefined> {
		if (!this.canApply) {
			return undefined;
		}
		const resolutions: IResolution[] = [...this._resolutions].map(([overlapId, choice]) => ({ overlapId, choice }));
		return this._run(resolutions);
	}

	backOut(): void {
		this._resolutions.clear();
		this._collisionChoices = [];
		this._inputsChanged = undefined;
		this._onDidChange.fire();
	}

	/** Calls `getIncoming` through `runAction` with the basis the person reviewed. */
	private async _run(resolutions: IResolution[]): Promise<OperationResult | undefined> {
		if (!this._preview) {
			await this.refreshPreview();
		}
		const preview = this._preview;
		if (!preview) {
			return undefined;
		}

		const result = await this._instantiationService.invokeFunction(accessor => runAction(accessor, 'file-changing', async (engine, context) => {
			this._collisionChoices = mergeCollisionChoices(this._collisionChoices, context.collisionChoices);
			const result = await engine.getIncoming(preview.basis, resolutions, this._collisionChoices);
			// Taken before `runAction` routes the result, so the overlap editor opens on the new preview.
			this._takeResult(result);
			return result;
		}));
		if (result?.kind === 'done') {
			this._messageService.show(Strings.sync.done());
		}
		return result;
	}

	private _takeResult(result: OperationResult): void {
		if (result.kind === 'overlaps' || result.kind === 'inputs-changed' || result.kind === 'done') {
			// A read that started earlier must not replace the preview or the cleared state below.
			this._previewRequest++;
		}
		switch (result.kind) {
			case 'overlaps':
				this._setPreview(result.preview);
				this._inputsChanged = undefined;
				break;
			case 'inputs-changed':
				this._setPreview(result.preview);
				this._inputsChanged = result;
				if (result.changed.includes('files')) {
					// The files the choices were made for changed, so the person decides again.
					this._collisionChoices = [];
				}
				break;
			case 'done':
				this._preview = undefined;
				this._resolutions.clear();
				this._collisionChoices = [];
				this._inputsChanged = undefined;
				break;
			default:
				return;
		}
		this._onDidChange.fire();
	}

	/**
	 * Replaces the preview. A choice is kept only while its overlap is in the new preview. An
	 * overlap id is made from the kind and the three versions of the file, so a kept choice was
	 * made for exactly what the person reviewed.
	 */
	private _setPreview(preview: IIncomingPreview): void {
		this._preview = preview;
		const ids = new Set(preview.overlaps.map(overlap => overlap.id));
		for (const overlapId of [...this._resolutions.keys()]) {
			if (!ids.has(overlapId)) {
				this._resolutions.delete(overlapId);
			}
		}
	}
}

registerSingleton(ISyncController, SyncController, InstantiationType.Delayed);
