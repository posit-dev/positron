/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../../../platform/instantiation/common/extensions.js';
import { createDecorator, IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { CellEditor } from './CellEditor.js';
import { CellEditorPool, IDisposableReference } from './CellEditorPool.js';

export const IPositronNotebookCellEditorPoolService =
	createDecorator<IPositronNotebookCellEditorPoolService>('positronNotebookCellEditorPoolService');

/**
 * A workbench-global home for the {@link CellEditorPool}.
 *
 * Hosting the pool as a singleton (rather than per notebook component mount)
 * means live {@link CellEditor} instances outlive any single notebook view:
 * they survive tab swaps and are shared across separate editor panes, so a cell
 * remounted in a different pane can pick up a warm editor instead of rebuilding
 * one. {@link CellEditor} is host-agnostic and (re)binds to a cell -- and through
 * it the owning notebook instance -- on {@link CellEditor.setCell}, which is what
 * lets a single pooled editor be re-pointed at cells in different notebooks.
 *
 * Editors are keyed by cell URI (globally unique), so a remount prefers the
 * editor that last served the same cell; the key is a best-effort hint and the
 * pool falls back to any idle editor otherwise.
 */
export interface IPositronNotebookCellEditorPoolService {
	readonly _serviceBrand: undefined;

	/** The editors currently checked out of the pool. */
	readonly inUse: ReadonlySet<CellEditor>;

	/**
	 * Acquire a (possibly reused) editor for the cell identified by `key` (its
	 * URI). The returned reference must be disposed when the cell unmounts, which
	 * resets the editor and returns it to the pool for reuse.
	 */
	get(key: string): IDisposableReference<CellEditor>;
}

export class PositronNotebookCellEditorPoolService extends Disposable implements IPositronNotebookCellEditorPoolService {
	declare readonly _serviceBrand: undefined;

	private readonly _pool: CellEditorPool;

	get inUse(): ReadonlySet<CellEditor> {
		return this._pool.inUse;
	}

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();
		this._pool = this._register(instantiationService.createInstance(CellEditorPool));
	}

	get(key: string): IDisposableReference<CellEditor> {
		return this._pool.get(key);
	}
}

registerSingleton(IPositronNotebookCellEditorPoolService, PositronNotebookCellEditorPoolService, InstantiationType.Delayed);
