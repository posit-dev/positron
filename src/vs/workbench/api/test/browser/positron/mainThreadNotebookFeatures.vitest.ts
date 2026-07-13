/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { encodeBase64, VSBuffer } from '../../../../../base/common/buffer.js';
import { constObservable } from '../../../../../base/common/observable.js';
import { URI } from '../../../../../base/common/uri.js';
import { isEqual } from '../../../../../base/common/resources.js';
import { IExtHostContext } from '../../../../services/extensions/common/extHostCustomers.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { ILanguageRuntimeSession, IRuntimeSessionMetadata, IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { EditorsOrder, IVisibleEditorPane } from '../../../../common/editor.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { IPositronNotebookService } from '../../../../contrib/positronNotebook/browser/positronNotebookService.js';
import { IPositronNotebookInstance } from '../../../../contrib/positronNotebook/browser/IPositronNotebookInstance.js';
import { IPositronNotebookCodeCell, NotebookCellOutputs } from '../../../../contrib/positronNotebook/browser/PositronNotebookCells/IPositronNotebookCell.js';
import { SelectionState, SelectionStateMachine } from '../../../../contrib/positronNotebook/browser/selectionMachine.js';
import { UNSUPPORTED_NOTEBOOK_EDITOR_MESSAGE } from '../../../../contrib/positronNotebook/browser/notebookUtils.js';
import { POSITRON_NOTEBOOK_EDITOR_INPUT_ID } from '../../../../contrib/positronNotebook/common/positronNotebookCommon.js';
import { NOTEBOOK_EDITOR_ID } from '../../../../contrib/notebook/common/notebookCommon.js';
import { MainThreadNotebookFeatures } from '../../../browser/positron/mainThreadNotebookFeatures.js';

const { mockRasterizeSvgToPng } = vi.hoisted(() => ({ mockRasterizeSvgToPng: vi.fn() }));
vi.mock('../../../../contrib/positronNotebook/browser/svgToPng.js', () => ({
	rasterizeSvgToPng: mockRasterizeSvgToPng,
}));

const NOTEBOOK_URI = 'file:///test/notebook.ipynb';
const SVG_TEXT = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><circle r="50" /></svg>';
const PNG_BASE64 = 'bW9jay1wbmctZGF0YQ==';

/**
 * Builds a MainThreadNotebookFeatures whose single notebook has one code cell
 * with the given output items.
 */
function createFeatures(outputItems: { mime: string; data: VSBuffer }[]): MainThreadNotebookFeatures {
	const cellOutputs: NotebookCellOutputs[] = [stubInterface<NotebookCellOutputs>({
		outputId: 'output-1',
		outputs: outputItems,
	})];
	const cell = stubInterface<IPositronNotebookCodeCell>({
		// 'this is' type predicates can't be expressed in an object literal; cast the stub method.
		isCodeCell: (() => true) as IPositronNotebookCodeCell['isCodeCell'],
		outputs: constObservable(cellOutputs),
	});
	const instance = stubInterface<IPositronNotebookInstance>({
		cells: constObservable([cell]),
	});
	const notebookService = stubInterface<IPositronNotebookService>({
		listInstances: () => [instance],
	});
	return new MainThreadNotebookFeatures(
		stubInterface<IExtHostContext>(),
		stubInterface<IEditorService>(),
		notebookService,
		stubInterface<ILogService>({ warn: vi.fn() }),
		stubInterface<IConfigurationService>(),
		stubInterface<IRuntimeSessionService>(),
	);
}

describe('MainThreadNotebookFeatures $getCellOutputs SVG handling', () => {
	createTestContainer().build();

	it('rasterizes image/svg+xml outputs to a base64 png DTO', async () => {
		mockRasterizeSvgToPng.mockResolvedValue(PNG_BASE64);
		const features = createFeatures([{ mime: 'image/svg+xml', data: VSBuffer.fromString(SVG_TEXT) }]);

		const outputs = await features.$getCellOutputs(NOTEBOOK_URI, 0);

		expect(mockRasterizeSvgToPng).toHaveBeenCalledWith(SVG_TEXT);
		expect(outputs).toEqual([{ mimeType: 'image/png', data: PNG_BASE64 }]);
		features.dispose();
	});

	it('rasterizes SVG outputs whose MIME type carries parameters', async () => {
		mockRasterizeSvgToPng.mockResolvedValue(PNG_BASE64);
		const features = createFeatures([{ mime: 'image/svg+xml; charset=utf-8', data: VSBuffer.fromString(SVG_TEXT) }]);

		const outputs = await features.$getCellOutputs(NOTEBOOK_URI, 0);

		expect(outputs).toEqual([{ mimeType: 'image/png', data: PNG_BASE64 }]);
		features.dispose();
	});

	it('does not rasterize an SVG that has a raster image sibling in the same output', async () => {
		// Both items represent the same plot; rasterizing the SVG too would send
		// the model two identical images.
		const features = createFeatures([
			{ mime: 'image/png', data: VSBuffer.fromString('rawpngbytes') },
			{ mime: 'image/svg+xml', data: VSBuffer.fromString(SVG_TEXT) },
		]);

		const outputs = await features.$getCellOutputs(NOTEBOOK_URI, 0);

		expect(mockRasterizeSvgToPng).not.toHaveBeenCalled();
		expect(outputs).toEqual([
			{ mimeType: 'image/png', data: encodeBase64(VSBuffer.fromString('rawpngbytes')) },
			{ mimeType: 'image/svg+xml', data: SVG_TEXT },
		]);
		features.dispose();
	});

	it('falls back to raw SVG text when rasterization fails', async () => {
		mockRasterizeSvgToPng.mockResolvedValue(undefined);
		const features = createFeatures([{ mime: 'image/svg+xml', data: VSBuffer.fromString(SVG_TEXT) }]);

		const outputs = await features.$getCellOutputs(NOTEBOOK_URI, 0);

		expect(outputs).toEqual([{ mimeType: 'image/svg+xml', data: SVG_TEXT }]);
		features.dispose();
	});
});

describe('MainThreadNotebookFeatures $getActiveNotebookContext', () => {
	createTestContainer().build();

	const TEXT_FILE_EDITOR_PANE_ID = 'workbench.editors.files.textFileEditor';
	const TEXT_FILE_EDITOR_INPUT_ID = 'workbench.editors.files.fileEditorInput';

	/** A notebook instance stub with no cells, no kernel, and no selection. */
	function createNotebookInstance(uriString: string): IPositronNotebookInstance {
		return stubInterface<IPositronNotebookInstance>({
			uri: URI.parse(uriString),
			cells: constObservable([]),
			kernel: constObservable(undefined),
			selectionStateMachine: stubInterface<SelectionStateMachine>({
				state: constObservable({ type: SelectionState.NoCells }),
			}),
		});
	}

	/** An editor input stub as it appears in the editor service's MRU list. */
	function createEditorInput(typeId: string, uriString: string): EditorInput {
		return stubInterface<EditorInput>({
			typeId,
			resource: URI.parse(uriString),
		});
	}

	/**
	 * Builds a MainThreadNotebookFeatures against a stubbed editor state: the
	 * given active pane, editors in most-recently-active order, and the open
	 * Positron notebook instances.
	 */
	/** A foreground session stub attached to the given notebook. */
	function createForegroundNotebookSession(uriString: string): ILanguageRuntimeSession {
		return stubInterface<ILanguageRuntimeSession>({
			metadata: stubInterface<IRuntimeSessionMetadata>({
				notebookUri: URI.parse(uriString),
			}),
		});
	}

	function createContextFeatures(options: {
		activeEditorPane: IVisibleEditorPane | undefined;
		mruEditors: EditorInput[];
		instances: IPositronNotebookInstance[];
		foregroundSession?: ILanguageRuntimeSession;
	}): MainThreadNotebookFeatures {
		const editorService = stubInterface<IEditorService>({
			activeEditorPane: options.activeEditorPane,
			// Order-sensitive: only the most-recently-active query sees the
			// editors, so a regression to another EditorsOrder fails here.
			getEditors: (order: EditorsOrder) => order === EditorsOrder.MOST_RECENTLY_ACTIVE
				? options.mruEditors.map((editor, groupId) => ({ groupId, editor }))
				: [],
		});
		const notebookService = stubInterface<IPositronNotebookService>({
			listInstances: (uri?: URI) => options.instances.filter(instance => !uri || isEqual(instance.uri, uri)),
		});
		return new MainThreadNotebookFeatures(
			stubInterface<IExtHostContext>(),
			editorService,
			notebookService,
			stubInterface<ILogService>(),
			stubInterface<IConfigurationService>(),
			stubInterface<IRuntimeSessionService>({
				getNotebookSessionForNotebookUri: () => undefined,
				foregroundSession: options.foregroundSession,
			}),
		);
	}

	it('resolves an open Positron notebook when it is not the active editor pane (#14762)', async () => {
		const notebookUri = 'file:///test/notebook.ipynb';
		const notebook = createNotebookInstance(notebookUri);
		// Focus is elsewhere: the user is typing in another editor (chat
		// editor, split group, another file tab) while the notebook stays
		// open in its own tab.
		const features = createContextFeatures({
			activeEditorPane: stubInterface<IVisibleEditorPane>({ getId: () => TEXT_FILE_EDITOR_PANE_ID }),
			mruEditors: [
				createEditorInput(TEXT_FILE_EDITOR_INPUT_ID, 'file:///test/script.py'),
				createEditorInput(POSITRON_NOTEBOOK_EDITOR_INPUT_ID, notebookUri),
			],
			instances: [notebook],
		});

		const context = await features.$getActiveNotebookContext();

		expect(context?.uri).toBe(notebookUri);
		features.dispose();
	});

	it('resolves the most recently active notebook when multiple are open and none is active', async () => {
		const olderUri = 'file:///test/older.ipynb';
		const recentUri = 'file:///test/recent.ipynb';
		// Registration order (older first) deliberately differs from MRU
		// order (recent first): the fallback must follow the editor
		// service's most-recently-active order, not instance registration.
		const features = createContextFeatures({
			activeEditorPane: stubInterface<IVisibleEditorPane>({ getId: () => TEXT_FILE_EDITOR_PANE_ID }),
			mruEditors: [
				createEditorInput(TEXT_FILE_EDITOR_INPUT_ID, 'file:///test/script.py'),
				createEditorInput(POSITRON_NOTEBOOK_EDITOR_INPUT_ID, recentUri),
				createEditorInput(POSITRON_NOTEBOOK_EDITOR_INPUT_ID, olderUri),
			],
			instances: [createNotebookInstance(olderUri), createNotebookInstance(recentUri)],
		});

		const context = await features.$getActiveNotebookContext();

		expect(context?.uri).toBe(recentUri);
		features.dispose();
	});

	it('prefers the foreground session\'s notebook over a more recently active notebook editor', async () => {
		const attachedUri = 'file:///test/attached.ipynb';
		const recentUri = 'file:///test/recent.ipynb';
		// The user's session (what the interpreter picker shows, and what the
		// assistant's notebook mode is keyed on) is attached to one notebook
		// while another notebook's editor was touched more recently: the
		// attached notebook wins.
		const features = createContextFeatures({
			activeEditorPane: stubInterface<IVisibleEditorPane>({ getId: () => TEXT_FILE_EDITOR_PANE_ID }),
			mruEditors: [
				createEditorInput(POSITRON_NOTEBOOK_EDITOR_INPUT_ID, recentUri),
				createEditorInput(POSITRON_NOTEBOOK_EDITOR_INPUT_ID, attachedUri),
			],
			instances: [createNotebookInstance(attachedUri), createNotebookInstance(recentUri)],
			foregroundSession: createForegroundNotebookSession(attachedUri),
		});

		const context = await features.$getActiveNotebookContext();

		expect(context?.uri).toBe(attachedUri);
		features.dispose();
	});

	it('falls back to the most recently active notebook editor when the foreground notebook is closed', async () => {
		const closedUri = 'file:///test/closed.ipynb';
		const openUri = 'file:///test/open.ipynb';
		// The foreground session's notebook editor was closed (its session may
		// still be running); resolution must not target a closed notebook.
		const features = createContextFeatures({
			activeEditorPane: stubInterface<IVisibleEditorPane>({ getId: () => TEXT_FILE_EDITOR_PANE_ID }),
			mruEditors: [createEditorInput(POSITRON_NOTEBOOK_EDITOR_INPUT_ID, openUri)],
			instances: [createNotebookInstance(openUri)],
			foregroundSession: createForegroundNotebookSession(closedUri),
		});

		const context = await features.$getActiveNotebookContext();

		expect(context?.uri).toBe(openUri);
		features.dispose();
	});

	it('resolves undefined when no Positron notebook is open anywhere', async () => {
		const features = createContextFeatures({
			activeEditorPane: stubInterface<IVisibleEditorPane>({ getId: () => TEXT_FILE_EDITOR_PANE_ID }),
			mruEditors: [createEditorInput(TEXT_FILE_EDITOR_INPUT_ID, 'file:///test/script.py')],
			instances: [],
		});

		expect(await features.$getActiveNotebookContext()).toBeUndefined();
		features.dispose();
	});

	it('surfaces the unsupported-editor error when the built-in notebook editor is active, even if a Positron notebook is open elsewhere', async () => {
		// The user is looking at a notebook in the built-in editor; falling
		// back to a different open Positron notebook would make assistant
		// tools operate on the wrong notebook.
		const notebookUri = 'file:///test/notebook.ipynb';
		const features = createContextFeatures({
			activeEditorPane: stubInterface<IVisibleEditorPane>({ getId: () => NOTEBOOK_EDITOR_ID }),
			mruEditors: [createEditorInput(POSITRON_NOTEBOOK_EDITOR_INPUT_ID, notebookUri)],
			instances: [createNotebookInstance(notebookUri)],
		});

		await expect(features.$getActiveNotebookContext()).rejects.toThrow(UNSUPPORTED_NOTEBOOK_EDITOR_MESSAGE);
		features.dispose();
	});
});
