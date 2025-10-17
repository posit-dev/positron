/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IVisibleEditorPane } from '../../../../common/editor.js';
import { getActiveNotebook, hasConnectedNotebookForUri, getAllPositronNotebookInstances } from '../../browser/notebookUtils.js';
import { POSITRON_NOTEBOOK_EDITOR_ID } from '../../common/positronNotebookCommon.js';
import { PositronNotebookEditor } from '../../browser/PositronNotebookEditor.js';
import { IPositronNotebookInstance } from '../../browser/IPositronNotebookInstance.js';

suite('notebookUtils', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	suite('getActiveNotebook', () => {
		test('returns undefined when no active editor', () => {
			const editorService = new class extends mock<IEditorService>() {
				override activeEditorPane = undefined;
			};

			const result = getActiveNotebook(editorService);
			assert.strictEqual(result, undefined);
		});

		test('returns undefined when active editor is not a Positron notebook', () => {
			const mockEditorPane = new class extends mock<IVisibleEditorPane>() {
				override getId() { return 'some-other-editor'; }
			} as any;

			const editorService = new class extends mock<IEditorService>() {
				override activeEditorPane = mockEditorPane;
			};

			const result = getActiveNotebook(editorService);
			assert.strictEqual(result, undefined);
		});

		test('returns notebook instance when active editor is a Positron notebook', () => {
			const mockInstance = new class extends mock<IPositronNotebookInstance>() {
				override id = 'test-instance-id';
			} as any;

			const mockEditorPane = new class extends mock<PositronNotebookEditor>() {
				override getId() { return POSITRON_NOTEBOOK_EDITOR_ID; }
				override get notebookInstance() { return mockInstance; }
			} as any;

			const editorService = new class extends mock<IEditorService>() {
				override activeEditorPane = mockEditorPane;
			};

			const result = getActiveNotebook(editorService);
			assert.strictEqual(result, mockInstance);
		});
	});

	suite('hasConnectedNotebookForUri', () => {
		test('returns false when no notebooks', () => {
			const editorService = new class extends mock<IEditorService>() {
				override visibleEditorPanes: readonly IVisibleEditorPane[] = [];
			};

			const result = hasConnectedNotebookForUri(editorService, URI.file('/test.ipynb'));
			assert.strictEqual(result, false);
		});

		test('returns false when notebook exists but not connected', () => {
			const testUri = URI.file('/test.ipynb');

			const mockInstance = new class extends mock<IPositronNotebookInstance>() {
				override get uri() { return testUri; }
				override connectedToEditor = false;
			} as any;

			const mockEditor = new class extends mock<PositronNotebookEditor>() {
				override getId() { return POSITRON_NOTEBOOK_EDITOR_ID; }
				override get notebookInstance() { return mockInstance; }
			} as any;

			const editorService = new class extends mock<IEditorService>() {
				override visibleEditorPanes = [mockEditor];
			};

			const result = hasConnectedNotebookForUri(editorService, testUri);
			assert.strictEqual(result, false);
		});

		test('returns false when notebook exists with different URI', () => {
			const testUri1 = URI.file('/test1.ipynb');
			const testUri2 = URI.file('/test2.ipynb');

			const mockInstance = new class extends mock<IPositronNotebookInstance>() {
				override get uri() { return testUri1; }
				override connectedToEditor = true;
			} as any;

			const mockEditor = new class extends mock<PositronNotebookEditor>() {
				override getId() { return POSITRON_NOTEBOOK_EDITOR_ID; }
				override get notebookInstance() { return mockInstance; }
			} as any;

			const editorService = new class extends mock<IEditorService>() {
				override visibleEditorPanes = [mockEditor];
			};

			const result = hasConnectedNotebookForUri(editorService, testUri2);
			assert.strictEqual(result, false);
		});

		test('returns true when connected notebook exists', () => {
			const testUri = URI.file('/test.ipynb');

			const mockInstance = new class extends mock<IPositronNotebookInstance>() {
				override get uri() { return testUri; }
				override connectedToEditor = true;
			} as any;

			const mockEditor = new class extends mock<PositronNotebookEditor>() {
				override getId() { return POSITRON_NOTEBOOK_EDITOR_ID; }
				override get notebookInstance() { return mockInstance; }
			} as any;

			const editorService = new class extends mock<IEditorService>() {
				override visibleEditorPanes = [mockEditor];
			};

			const result = hasConnectedNotebookForUri(editorService, testUri);
			assert.strictEqual(result, true);
		});

		test('handles multiple notebooks with same URI correctly', () => {
			const testUri = URI.file('/test.ipynb');

			const mockInstance1 = new class extends mock<IPositronNotebookInstance>() {
				override get uri() { return testUri; }
				override connectedToEditor = false;
			} as any;

			const mockInstance2 = new class extends mock<IPositronNotebookInstance>() {
				override get uri() { return testUri; }
				override connectedToEditor = true;
			} as any;

			const mockEditor1 = new class extends mock<PositronNotebookEditor>() {
				override getId() { return POSITRON_NOTEBOOK_EDITOR_ID; }
				override get notebookInstance() { return mockInstance1; }
			} as any;

			const mockEditor2 = new class extends mock<PositronNotebookEditor>() {
				override getId() { return POSITRON_NOTEBOOK_EDITOR_ID; }
				override get notebookInstance() { return mockInstance2; }
			} as any;

			const editorService = new class extends mock<IEditorService>() {
				override visibleEditorPanes = [mockEditor1, mockEditor2];
			};

			const result = hasConnectedNotebookForUri(editorService, testUri);
			assert.strictEqual(result, true);
		});

		test('handles notebook instance being undefined', () => {
			const testUri = URI.file('/test.ipynb');

			const mockEditor = new class extends mock<PositronNotebookEditor>() {
				override getId() { return POSITRON_NOTEBOOK_EDITOR_ID; }
				override get notebookInstance() { return undefined; }
			} as any;

			const editorService = new class extends mock<IEditorService>() {
				override visibleEditorPanes = [mockEditor];
			};

			const result = hasConnectedNotebookForUri(editorService, testUri);
			assert.strictEqual(result, false);
		});

		test('ignores non-Positron notebook editors', () => {
			const testUri = URI.file('/test.ipynb');

			const mockEditor = new class extends mock<IVisibleEditorPane>() {
				override getId() { return 'some-other-editor'; }
			} as any;

			const editorService = new class extends mock<IEditorService>() {
				override visibleEditorPanes = [mockEditor];
			};

			const result = hasConnectedNotebookForUri(editorService, testUri);
			assert.strictEqual(result, false);
		});
	});

	suite('getAllPositronNotebookInstances', () => {
		test('returns empty array when no notebooks', () => {
			const editorService = new class extends mock<IEditorService>() {
				override visibleEditorPanes: readonly IVisibleEditorPane[] = [];
			};

			const result = getAllPositronNotebookInstances(editorService);
			assert.strictEqual(result.length, 0);
		});

		test('returns all notebooks when no URI filter', () => {
			const uri1 = URI.file('/test1.ipynb');
			const uri2 = URI.file('/test2.ipynb');

			const mockInstance1 = new class extends mock<IPositronNotebookInstance>() {
				override get uri() { return uri1; }
			} as any;

			const mockInstance2 = new class extends mock<IPositronNotebookInstance>() {
				override get uri() { return uri2; }
			} as any;

			const mockEditor1 = new class extends mock<PositronNotebookEditor>() {
				override getId() { return POSITRON_NOTEBOOK_EDITOR_ID; }
				override get notebookInstance() { return mockInstance1; }
			} as any;

			const mockEditor2 = new class extends mock<PositronNotebookEditor>() {
				override getId() { return POSITRON_NOTEBOOK_EDITOR_ID; }
				override get notebookInstance() { return mockInstance2; }
			} as any;

			const editorService = new class extends mock<IEditorService>() {
				override visibleEditorPanes = [mockEditor1, mockEditor2];
			};

			const result = getAllPositronNotebookInstances(editorService);
			assert.strictEqual(result.length, 2);
			assert.strictEqual(result[0], mockInstance1);
			assert.strictEqual(result[1], mockInstance2);
		});

		test('filters correctly by URI', () => {
			const uri1 = URI.file('/test1.ipynb');
			const uri2 = URI.file('/test2.ipynb');

			const mockInstance1 = new class extends mock<IPositronNotebookInstance>() {
				override get uri() { return uri1; }
			} as any;

			const mockInstance2 = new class extends mock<IPositronNotebookInstance>() {
				override get uri() { return uri2; }
			} as any;

			const mockEditor1 = new class extends mock<PositronNotebookEditor>() {
				override getId() { return POSITRON_NOTEBOOK_EDITOR_ID; }
				override get notebookInstance() { return mockInstance1; }
			} as any;

			const mockEditor2 = new class extends mock<PositronNotebookEditor>() {
				override getId() { return POSITRON_NOTEBOOK_EDITOR_ID; }
				override get notebookInstance() { return mockInstance2; }
			} as any;

			const editorService = new class extends mock<IEditorService>() {
				override visibleEditorPanes = [mockEditor1, mockEditor2];
			};

			const result = getAllPositronNotebookInstances(editorService, uri1);
			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0], mockInstance1);
		});

		test('returns multiple instances for same URI', () => {
			const testUri = URI.file('/test.ipynb');

			const mockInstance1 = new class extends mock<IPositronNotebookInstance>() {
				override get uri() { return testUri; }
				override id = 'instance-1';
			} as any;

			const mockInstance2 = new class extends mock<IPositronNotebookInstance>() {
				override get uri() { return testUri; }
				override id = 'instance-2';
			} as any;

			const mockEditor1 = new class extends mock<PositronNotebookEditor>() {
				override getId() { return POSITRON_NOTEBOOK_EDITOR_ID; }
				override get notebookInstance() { return mockInstance1; }
			} as any;

			const mockEditor2 = new class extends mock<PositronNotebookEditor>() {
				override getId() { return POSITRON_NOTEBOOK_EDITOR_ID; }
				override get notebookInstance() { return mockInstance2; }
			} as any;

			const editorService = new class extends mock<IEditorService>() {
				override visibleEditorPanes = [mockEditor1, mockEditor2];
			};

			const result = getAllPositronNotebookInstances(editorService, testUri);
			assert.strictEqual(result.length, 2);
			assert.strictEqual(result[0], mockInstance1);
			assert.strictEqual(result[1], mockInstance2);
		});

		test('handles notebook instance being undefined', () => {
			const mockEditor = new class extends mock<PositronNotebookEditor>() {
				override getId() { return POSITRON_NOTEBOOK_EDITOR_ID; }
				override get notebookInstance() { return undefined; }
			} as any;

			const editorService = new class extends mock<IEditorService>() {
				override visibleEditorPanes = [mockEditor];
			};

			const result = getAllPositronNotebookInstances(editorService);
			assert.strictEqual(result.length, 0);
		});

		test('ignores non-Positron notebook editors', () => {
			const uri1 = URI.file('/test1.ipynb');

			const mockInstance = new class extends mock<IPositronNotebookInstance>() {
				override get uri() { return uri1; }
			} as any;

			const mockPositronEditor = new class extends mock<PositronNotebookEditor>() {
				override getId() { return POSITRON_NOTEBOOK_EDITOR_ID; }
				override get notebookInstance() { return mockInstance; }
			} as any;

			const mockOtherEditor = new class extends mock<IVisibleEditorPane>() {
				override getId() { return 'some-other-editor'; }
			} as any;

			const editorService = new class extends mock<IEditorService>() {
				override visibleEditorPanes = [mockOtherEditor, mockPositronEditor];
			};

			const result = getAllPositronNotebookInstances(editorService);
			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0], mockInstance);
		});

		test('filters out non-matching URIs when filter is provided', () => {
			const uri1 = URI.file('/test1.ipynb');
			const uri2 = URI.file('/test2.ipynb');
			const uri3 = URI.file('/test3.ipynb');

			const mockInstance1 = new class extends mock<IPositronNotebookInstance>() {
				override get uri() { return uri1; }
			} as any;

			const mockInstance2 = new class extends mock<IPositronNotebookInstance>() {
				override get uri() { return uri2; }
			} as any;

			const mockInstance3 = new class extends mock<IPositronNotebookInstance>() {
				override get uri() { return uri3; }
			} as any;

			const mockEditor1 = new class extends mock<PositronNotebookEditor>() {
				override getId() { return POSITRON_NOTEBOOK_EDITOR_ID; }
				override get notebookInstance() { return mockInstance1; }
			} as any;

			const mockEditor2 = new class extends mock<PositronNotebookEditor>() {
				override getId() { return POSITRON_NOTEBOOK_EDITOR_ID; }
				override get notebookInstance() { return mockInstance2; }
			} as any;

			const mockEditor3 = new class extends mock<PositronNotebookEditor>() {
				override getId() { return POSITRON_NOTEBOOK_EDITOR_ID; }
				override get notebookInstance() { return mockInstance3; }
			} as any;

			const editorService = new class extends mock<IEditorService>() {
				override visibleEditorPanes = [mockEditor1, mockEditor2, mockEditor3];
			};

			const result = getAllPositronNotebookInstances(editorService, uri2);
			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0], mockInstance2);
		});
	});
});
