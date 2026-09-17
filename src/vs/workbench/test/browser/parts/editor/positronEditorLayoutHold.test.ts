/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { timeout } from '../../../../../base/common/async.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { EditorPart, IEditorPartUIState } from '../../../../browser/parts/editor/editorPart.js';
import { holdStoredEditorLayout } from '../../../../browser/positronEditorPartsLayout.js';
import { Memento } from '../../../../common/memento.js';
import { IAuxiliaryWindowService } from '../../../../services/auxiliaryWindow/browser/auxiliaryWindowService.js';
import { GroupDirection, IAuxiliaryEditorPart } from '../../../../services/editor/common/editorGroupsService.js';
import { createEditorParts, ITestInstantiationService, TestEditorPart, TestEditorParts, workbenchInstantiationService, workbenchTeardown } from '../../../../test/browser/workbenchTestServices.js';

/**
 * The storage keys the two editor-part mementos live under: `Memento`
 * prefixes the component id, and each component stores its layout under its
 * own key inside that object (`EditorPart.EDITOR_PART_UI_STATE_STORAGE_KEY`
 * and `EditorParts.EDITOR_PARTS_UI_STATE_STORAGE_KEY`).
 */
const MAIN_PART_MEMENTO_KEY = 'memento/workbench.parts.editor';
const MAIN_PART_STATE_KEY = 'editorpart.state';
const EDITOR_PARTS_MEMENTO_KEY = 'memento/workbench.editorParts';
const EDITOR_PARTS_STATE_KEY = 'editorparts.state';

/**
 * An auxiliary editor part without an auxiliary window: enough for
 * `EditorParts.applyState` to find it and close it.
 */
class TestAuxiliaryEditorPart extends EditorPart implements IAuxiliaryEditorPart {

	private readonly _onWillClose = this._register(new Emitter<void>());
	readonly onWillClose = this._onWillClose.event;

	closed = false;

	close(): boolean {
		this.closed = true;
		this._onWillClose.fire();
		return true;
	}

	protected override loadState(): IEditorPartUIState | undefined {
		return undefined;
	}

	protected override saveState(): void {
		// auxiliary editor part state is tracked by EditorParts
	}
}

suite('Positron editor layout hold', () => {

	const disposables = new DisposableStore();

	let instantiationService: ITestInstantiationService;
	let parts: TestEditorParts;
	let mainPart: TestEditorPart;
	let storageService: IStorageService;

	setup(async () => {
		// The scoped mementos are cached per component id across the whole
		// test process; start from ones bound to this test's storage service.
		Memento.clear(StorageScope.WORKSPACE);

		instantiationService = workbenchInstantiationService(undefined, disposables);
		// Real auxiliary windows cannot open here, and the stored layouts below
		// never ask for one: `AuxiliaryEditorPart.create` leaks its disposable
		// store when `open` rejects, which the leak check would report.
		const auxiliaryWindowService: IAuxiliaryWindowService = {
			_serviceBrand: undefined,
			onDidOpenAuxiliaryWindow: Event.None,
			open: () => Promise.reject(new Error('auxiliary windows cannot open in tests')),
			getWindow: () => undefined
		};
		instantiationService.stub(IAuxiliaryWindowService, auxiliaryWindowService);

		parts = await createEditorParts(instantiationService, disposables);
		mainPart = parts.testMainPart;
		storageService = instantiationService.invokeFunction(accessor => accessor.get(IStorageService));
	});

	teardown(async () => {
		await workbenchTeardown(instantiationService);
		Memento.clear(StorageScope.WORKSPACE);
		disposables.clear();
	});

	function createAuxiliaryPart(): TestAuxiliaryEditorPart {
		const part = disposables.add(instantiationService.createInstance(TestAuxiliaryEditorPart, parts, 'workbench.parts.auxiliaryEditor.test', 'Test', mainWindow.vscodeWindowId + 1));
		const registration = disposables.add(parts.registerPart(part));
		disposables.add(Event.once(part.onWillClose)(() => registration.dispose()));
		part.create(document.createElement('div'));
		part.layout(800, 600, 0, 0);

		return part;
	}

	/** A main-part layout with two groups, produced the way `saveState` would. */
	function createTwoGroupState(): IEditorPartUIState {
		const rightGroup = mainPart.addGroup(mainPart.activeGroup, GroupDirection.RIGHT);
		const state = mainPart.createState();
		mainPart.removeGroup(rightGroup);
		assert.strictEqual(mainPart.count, 1);

		return state;
	}

	/**
	 * Write both mementos the way a storage switch surfaces them: from outside
	 * this window. The parts layout stores no auxiliary windows, so adopting
	 * it closes the open ones without asking for new windows.
	 */
	function storeExternalLayout(mainState: IEditorPartUIState): void {
		storageService.storeAll([
			{ key: MAIN_PART_MEMENTO_KEY, value: { [MAIN_PART_STATE_KEY]: mainState }, scope: StorageScope.WORKSPACE, target: StorageTarget.USER },
			{ key: EDITOR_PARTS_MEMENTO_KEY, value: { [EDITOR_PARTS_STATE_KEY]: { auxiliary: [], mru: [0] } }, scope: StorageScope.WORKSPACE, target: StorageTarget.USER }
		], true);
	}

	async function settle(): Promise<void> {
		for (let i = 0; i < 5; i++) {
			await timeout(0);
		}
	}

	test('held: an external stored-layout change leaves both parts alone', async () => {
		const auxiliaryPart = createAuxiliaryPart();
		disposables.add(holdStoredEditorLayout());

		storeExternalLayout(createTwoGroupState());
		await settle();

		assert.deepStrictEqual({
			mainGroups: mainPart.count,
			parts: parts.parts.length,
			auxiliaryClosed: auxiliaryPart.closed
		}, {
			mainGroups: 1,
			parts: 2,
			auxiliaryClosed: false
		});
	});

	test('unheld: an external stored-layout change closes the auxiliary part and applies the main layout', async () => {
		const auxiliaryPart = createAuxiliaryPart();
		const mainGroupAdded = Event.toPromise(mainPart.onDidAddGroup);
		const auxiliaryClosed = Event.toPromise(auxiliaryPart.onWillClose);

		storeExternalLayout(createTwoGroupState());
		await Promise.all([mainGroupAdded, auxiliaryClosed]);
		await settle();

		assert.deepStrictEqual({
			mainGroups: mainPart.count,
			parts: parts.parts.length,
			auxiliaryClosed: auxiliaryPart.closed
		}, {
			mainGroups: 2,
			parts: 1,
			auxiliaryClosed: true
		});
	});

	test('applyStoredState applies the layout stored during a hold', async () => {
		const hold = disposables.add(holdStoredEditorLayout());
		storeExternalLayout(createTwoGroupState());
		await settle();
		assert.strictEqual(mainPart.count, 1);
		hold.dispose();

		await mainPart.applyStoredState();
		assert.strictEqual(mainPart.count, 2);

		// With nothing stored it resolves and leaves the layout alone.
		mainPart.clearState();
		await mainPart.applyStoredState();
		assert.strictEqual(mainPart.count, 2);
	});

	ensureNoDisposablesAreLeakedInTestSuite();
});
