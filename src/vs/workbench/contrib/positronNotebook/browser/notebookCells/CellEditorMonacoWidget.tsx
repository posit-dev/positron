/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './CellEditorMonacoWidget.css';

// React.
import React from 'react';

// Other dependencies.
import { usePositronConfiguration } from '../../../../../base/browser/positronReactHooks.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { POSITRON_NOTEBOOK_REUSE_CELL_EDITORS_KEY } from '../../common/positronNotebookConfig.js';
import { PositronNotebookCellGeneral } from '../PositronNotebookCells/PositronNotebookCell.js';
import { CellEditor } from './CellEditor.js';
import { IPositronNotebookCellEditorPoolService } from './PositronNotebookCellEditorPoolService.js';

/**
 * An editor widget for a notebook cell.
 *
 * Behaviour is gated on the `positron.notebook.reuseCellEditors` setting:
 *
 * - ON (default): acquire a (possibly reused) {@link CellEditor} from the
 *   workbench-global {@link IPositronNotebookCellEditorPoolService}. On unmount
 *   the editor is reset and returned to the pool rather than disposed, so it
 *   stays warm across cell mounts, tab swaps, and separate editor panes.
 * - OFF: construct a fresh {@link CellEditor} on mount and dispose it on unmount.
 *   No pool, no reuse -- the conservative construct-per-mount fallback.
 *
 * The setting is read reactively, so flipping it re-mounts the widget onto the
 * other path (and reload is always a safe fallback).
 *
 * @param opts.cell Cell to be shown and edited in the editor widget
 * @returns An editor widget for the cell
 */
export function CellEditorMonacoWidget({ cell }: { cell: PositronNotebookCellGeneral }) {
	const reuseCellEditors = usePositronConfiguration<boolean>(POSITRON_NOTEBOOK_REUSE_CELL_EDITORS_KEY);

	return reuseCellEditors
		? <PooledCellEditorMonacoWidget cell={cell} />
		: <OwnedCellEditorMonacoWidget cell={cell} />;
}

/**
 * Pooled path: acquire a (possibly reused) editor from the global pool, mount
 * its owned root element into this cell's row, and bind it to the cell. On
 * unmount the reference is disposed, which resets the editor (detaching cell +
 * DOM) and returns it to the pool for reuse rather than disposing it.
 */
function PooledCellEditorMonacoWidget({ cell }: { cell: PositronNotebookCellGeneral }) {
	const pool = usePositronReactServicesContext().get(IPositronNotebookCellEditorPoolService);

	const mountRef = React.useRef<HTMLDivElement>(null);

	React.useEffect(() => {
		if (!mountRef.current || !cell.scopedContextKeyService) { return; }

		const ref = pool.get(cell.uri.toString());
		const cellEditor = ref.object;
		// Attach to the DOM before binding so the editor is connected when its
		// model attaches -- a pooled editor may have been parked off-DOM.
		mountRef.current.appendChild(cellEditor.element);
		cellEditor.setCell(cell);

		return () => ref.dispose();
	}, [cell, pool]);

	return <CellEditorMount mountRef={mountRef} />;
}

/**
 * Construct-per-mount path: build a fresh {@link CellEditor} on mount, mount its
 * owned root element into this cell's row, bind it to the cell, and dispose it
 * on unmount. No pool and no reuse.
 */
function OwnedCellEditorMonacoWidget({ cell }: { cell: PositronNotebookCellGeneral }) {
	const { instantiationService } = usePositronReactServicesContext();

	const mountRef = React.useRef<HTMLDivElement>(null);

	React.useEffect(() => {
		if (!mountRef.current || !cell.scopedContextKeyService) { return; }

		const cellEditor = instantiationService.createInstance(CellEditor);
		mountRef.current.appendChild(cellEditor.element);
		cellEditor.setCell(cell);

		return () => cellEditor.dispose();
	}, [cell, instantiationService]);

	return <CellEditorMount mountRef={mountRef} />;
}

// CellEditor owns its DOM (editor container + focus target); we only render a
// mount point and let it append its root element here.
function CellEditorMount({ mountRef }: { mountRef: React.RefObject<HTMLDivElement | null> }) {
	return <div ref={mountRef} className='positron-cell-editor-mount' />;
}
