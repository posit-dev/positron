/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { waitFor } from '@testing-library/react';
import { IDisposable } from '../../../../../../base/common/lifecycle.js';
import { IContextKeyService } from '../../../../../../platform/contextkey/common/contextkey.js';
import { ContextKeyService } from '../../../../../../platform/contextkey/browser/contextKeyService.js';
import { TestConfigurationService } from '../../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IUserInteractionService } from '../../../../../../platform/userInteraction/browser/userInteractionService.js';
import { UserInteractionService } from '../../../../../../platform/userInteraction/browser/userInteractionServiceImpl.js';
import { createTestContainer } from '../../../../../../test/vitest/positronTestContainer.js';
import { CellKind } from '../../../../notebook/common/notebookCommon.js';
import { CellEditor } from '../../../browser/notebookCells/CellEditor.js';
import { CellEditorPool, KeyedResourcePool } from '../../../browser/notebookCells/CellEditorPool.js';
import { PositronNotebookCellGeneral } from '../../../browser/PositronNotebookCells/PositronNotebookCell.js';
import { createTestPositronNotebookInstance, TestPositronNotebookInstance } from '../testPositronNotebookInstance.js';

// Register a real editor contribution by side-effect so EditorExtensionsRegistry
// is populated when the pool builds CellEditors.
import '../../../../../../editor/contrib/folding/browser/folding.js';

describe('CellEditorPool', () => {
	const ctx = createTestContainer()
		.withNotebookEditorServices()
		// CellEditor builds a real CodeEditorWidget whose view needs
		// IUserInteractionService to create its DOM focus tracker.
		.stub(IUserInteractionService, new UserInteractionService())
		.build();

	// Real ContextKeyService so each cell's createScoped() allocates a genuine
	// scoped service the editor can reparent onto. Fresh per test.
	beforeEach(() => {
		const contextKeyService = ctx.disposables.add(new ContextKeyService(new TestConfigurationService()));
		ctx.instantiationService.stub(IContextKeyService, contextKeyService);
	});

	let currentNotebook: TestPositronNotebookInstance | undefined;
	let currentContainer: HTMLElement | undefined;
	let currentPool: CellEditorPool | undefined;

	afterEach(async () => {
		currentPool?.dispose();
		currentPool = undefined;
		currentNotebook?.dispose();
		currentNotebook = undefined;
		currentContainer?.remove();
		currentContainer = undefined;
		await new Promise(resolve => setTimeout(resolve, 0));
	});

	// Build a multi-cell notebook (each cell gets its own attached container so
	// its scoped context-key service exists) and a pool over it.
	function createPool(sources: string[]) {
		const notebook = createTestPositronNotebookInstance(
			sources.map(s => [s, 'python', CellKind.Code, []]),
			ctx,
		);
		currentNotebook = notebook;

		const notebookContainer = document.createElement('div');
		document.body.appendChild(notebookContainer);
		currentContainer = notebookContainer;
		notebook.container.set(notebookContainer, undefined);

		const cells = notebook.cells.get() as PositronNotebookCellGeneral[];
		const cellContainers = cells.map(cell => {
			const el = document.createElement('div');
			el.tabIndex = 0;
			notebookContainer.appendChild(el);
			cell.attachContainer(el);
			return el;
		});

		notebook.layout({ width: 800, height: 600 });
		const pool = notebook.scopedInstantiationService.createInstance(CellEditorPool);
		currentPool = pool;

		return { notebook, cells, cellContainers, pool };
	}

	// Acquire an editor for `cell`, mount it and bind it (the production path the
	// widget runs), waiting for the model to attach.
	async function acquire(pool: CellEditorPool, cell: PositronNotebookCellGeneral, container: HTMLElement) {
		const ref = pool.get(cell.uri.toString());
		const cellEditor = ref.object;
		container.appendChild(cellEditor.element);
		cellEditor.setCell(cell);
		await waitFor(() => expect(cellEditor.editor.getModel()).toBeTruthy());
		return ref;
	}

	it('creates a CellEditor on first acquire', () => {
		const { cells, pool } = createPool(['a = 1']);
		const ref = pool.get(cells[0].uri.toString());
		expect(ref.object).toBeInstanceOf(CellEditor);
	});

	it('tracks acquired editors as in use and releases them on dispose', async () => {
		const { cells, cellContainers, pool } = createPool(['a = 1']);
		const ref = await acquire(pool, cells[0], cellContainers[0]);

		expect(pool.inUse.has(ref.object)).toBe(true);

		ref.dispose();
		expect(pool.inUse.has(ref.object)).toBe(false);
	});

	it('resets the editor on release (detaching cell and DOM)', async () => {
		const { cells, cellContainers, pool } = createPool(['a = 1']);
		const ref = await acquire(pool, cells[0], cellContainers[0]);
		const editor = ref.object;
		expect(cells[0].currentEditor).toBe(editor.editor);

		ref.dispose();

		expect(cells[0].currentEditor).toBeUndefined();
		expect(editor.element.parentElement).toBeNull();
		expect(editor.editor.getModel()).toBeNull();
	});

	it('reuses the same editor for the same key', async () => {
		const { cells, cellContainers, pool } = createPool(['a = 1']);
		const ref1 = await acquire(pool, cells[0], cellContainers[0]);
		const editor = ref1.object;
		const disposeSpy = vi.spyOn(editor.editor, 'dispose');
		ref1.dispose();

		const ref2 = await acquire(pool, cells[0], cellContainers[0]);

		// The same live editor/widget is handed back rather than rebuilt.
		expect(ref2.object).toBe(editor);
		expect(disposeSpy).not.toHaveBeenCalled();
		expect(cells[0].currentEditor).toBe(editor.editor);
	});

	it('rebinds a reused editor to a different cell', async () => {
		const { cells, cellContainers, pool } = createPool(['a = 1', 'b = 2']);
		const ref1 = await acquire(pool, cells[0], cellContainers[0]);
		const editor = ref1.object;
		ref1.dispose();

		// No keyed match for cell B, but an idle editor exists -> reuse it.
		const ref2 = await acquire(pool, cells[1], cellContainers[1]);

		expect(ref2.object).toBe(editor);
		expect(editor.editor.getModel()?.getValue()).toBe('b = 2');
		expect(cells[1].currentEditor).toBe(editor.editor);
	});

	it('hands out distinct editors for concurrently mounted cells', async () => {
		const { cells, cellContainers, pool } = createPool(['a = 1', 'b = 2']);
		const refA = await acquire(pool, cells[0], cellContainers[0]);
		const refB = await acquire(pool, cells[1], cellContainers[1]);

		expect(refA.object).not.toBe(refB.object);
		expect(pool.inUse.size).toBe(2);
	});

	it('marks a released reference as stale', async () => {
		const { cells, cellContainers, pool } = createPool(['a = 1']);
		const ref = await acquire(pool, cells[0], cellContainers[0]);
		expect(ref.isStale()).toBe(false);

		ref.dispose();
		expect(ref.isStale()).toBe(true);
	});

	it('disposes editors still in use when the pool is disposed', async () => {
		const { cells, cellContainers, pool } = createPool(['a = 1']);
		const ref = await acquire(pool, cells[0], cellContainers[0]);
		const disposeSpy = vi.spyOn(ref.object.editor, 'dispose');

		pool.dispose();
		currentPool = undefined;

		expect(disposeSpy).toHaveBeenCalledTimes(1);
	});

	it('disposes idle editors when cleared', async () => {
		const { cells, cellContainers, pool } = createPool(['a = 1']);
		const ref = await acquire(pool, cells[0], cellContainers[0]);
		const disposeSpy = vi.spyOn(ref.object.editor, 'dispose');
		ref.dispose();

		pool.clear();

		expect(disposeSpy).toHaveBeenCalledTimes(1);
	});
});

describe('KeyedResourcePool', () => {
	// A lightweight disposable so we can exercise the pool primitive without
	// building real editors.
	class FakeItem implements IDisposable {
		disposed = false;
		dispose(): void { this.disposed = true; }
	}

	function makeFactoryPool(options?: { maxIdleSize?: number; trimIdleDelay?: number }) {
		let created = 0;
		const pool = new KeyedResourcePool<FakeItem>(() => { created++; return new FakeItem(); }, options);
		return { pool, created: () => created };
	}

	it('prefers an idle item released under the same key', () => {
		const { pool, created } = makeFactoryPool();
		const a = pool.get('k1');
		pool.release(a, 'k1');

		expect(pool.get('k1')).toBe(a);
		expect(created()).toBe(1);
	});

	it('falls back to any idle item when no keyed match is free', () => {
		const { pool, created } = makeFactoryPool();
		const a = pool.get('k1');
		pool.release(a, 'k1');

		// Different key, but the idle item is reused rather than building a new one.
		expect(pool.get('k2')).toBe(a);
		expect(created()).toBe(1);
	});

	it('creates a new item when all keyed matches are in use', () => {
		const { pool, created } = makeFactoryPool();
		const a = pool.get('k1');
		const b = pool.get('k1');

		expect(a).not.toBe(b);
		expect(created()).toBe(2);
	});

	it('tracks in-use items', () => {
		const { pool } = makeFactoryPool();
		const a = pool.get('k1');
		expect(pool.inUse.has(a)).toBe(true);

		pool.release(a, 'k1');
		expect(pool.inUse.has(a)).toBe(false);
	});

	it('trims idle items beyond maxIdleSize after the debounce delay', () => {
		vi.useFakeTimers();
		try {
			const { pool } = makeFactoryPool({ maxIdleSize: 1, trimIdleDelay: 100 });
			const a = pool.get('k1');
			const b = pool.get('k2');
			const c = pool.get('k3');
			pool.release(a, 'k1');
			pool.release(b, 'k2');
			pool.release(c, 'k3');

			// Nothing trimmed until the debounce elapses.
			expect([a, b, c].filter(i => i.disposed).length).toBe(0);

			vi.advanceTimersByTime(100);

			// Down to maxIdleSize idle items; the excess were disposed.
			expect([a, b, c].filter(i => i.disposed).length).toBe(2);
		} finally {
			vi.useRealTimers();
		}
	});

	it('disposes idle items on clear and leaves in-use items alone', () => {
		const { pool } = makeFactoryPool();
		const idle = pool.get('k1');
		const inUse = pool.get('k2');
		pool.release(idle, 'k1');

		pool.clear();

		expect(idle.disposed).toBe(true);
		expect(inUse.disposed).toBe(false);
	});

	it('disposes both idle and in-use items on dispose', () => {
		const { pool } = makeFactoryPool();
		const idle = pool.get('k1');
		const inUse = pool.get('k2');
		pool.release(idle, 'k1');

		pool.dispose();

		expect(idle.disposed).toBe(true);
		expect(inUse.disposed).toBe(true);
	});
});
