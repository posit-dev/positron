/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { URI } from '../../../../../base/common/uri.js';
import { Range } from '../../../../../editor/common/core/range.js';
import { ITextModel } from '../../../../../editor/common/model.js';
import {
	CodeAction,
	CodeActionContext,
	CodeActionList,
	CodeActionProvider,
	CodeActionTriggerType,
	IWorkspaceTextEdit,
} from '../../../../../editor/common/languages.js';
import { ILanguageFeaturesService } from '../../../../../editor/common/services/languageFeatures.js';
import { LanguageFeatureRegistry } from '../../../../../editor/common/languageFeatureRegistry.js';
import { MarkerSeverity } from '../../../../../platform/markers/common/markers.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { QuartoCodeActionProvider } from '../../browser/quartoCodeActionProvider.js';
import { createQuartoCellUri } from '../../browser/quartoCellModelSync.js';
import { IQuartoCellModelService } from '../../browser/quartoCellModelService.js';
import { IQuartoDocumentModelService } from '../../browser/quartoDocumentModelService.js';
import { IQuartoDocumentModel, QuartoCodeCell } from '../../common/quartoTypes.js';

const DOC_URI = URI.parse('file:///doc.qmd');
const CELL_URI = createQuartoCellUri(DOC_URI, 0);

// A chunk whose code occupies document lines 5..8 (fences on 4 and 9), so cell
// line 3 maps to document line 7.
const CELL: QuartoCodeCell = {
	id: 'c0', language: 'python', startLine: 4, endLine: 9,
	codeStartLine: 5, codeEndLine: 8, options: '', contentHash: '0', index: 0,
};

const CONTEXT: CodeActionContext = { trigger: CodeActionTriggerType.Invoke };

// A range on cell line 3 (== document line 7).
const CELL_RANGE = { startLineNumber: 3, startColumn: 1, endLineNumber: 3, endColumn: 4 };
const DOC_RANGE = { startLineNumber: 7, startColumn: 1, endLineNumber: 7, endColumn: 4 };

/** A fake server code-action provider returning a single action in CELL space. */
function fakeProvider(action: CodeAction, resolve?: (a: CodeAction) => CodeAction): CodeActionProvider {
	return {
		displayName: 'fake',
		provideCodeActions: (): CodeActionList => ({ actions: [action], dispose: () => { } }),
		resolveCodeAction: resolve,
	};
}

function setup(cellAtLine: QuartoCodeCell | undefined, downstream: CodeActionProvider[]) {
	const documentModel = stubInterface<IQuartoDocumentModel>({
		uri: DOC_URI,
		cells: [CELL],
		getCellAtLine: () => cellAtLine,
	});
	const documentModelService = stubInterface<IQuartoDocumentModelService>({
		hasModel: () => true,
		getModelForUri: () => documentModel,
	});
	const cellModel = stubInterface<ITextModel>({ uri: CELL_URI });
	const cellModelService = stubInterface<IQuartoCellModelService>({ getCellModel: () => cellModel });
	const codeActionProvider = stubInterface<LanguageFeatureRegistry<CodeActionProvider>>({
		ordered: () => downstream,
	});
	const languageFeaturesService = stubInterface<ILanguageFeaturesService>({ codeActionProvider });

	const provider = new QuartoCodeActionProvider(documentModelService, cellModelService, languageFeaturesService);
	const qmdModel = stubInterface<ITextModel>({ uri: DOC_URI });
	return { provider, qmdModel };
}

const textEdit = (resource: URI, range: typeof CELL_RANGE): IWorkspaceTextEdit =>
	({ resource, versionId: undefined, textEdit: { range, text: 'fixed' } });

describe('QuartoCodeActionProvider', () => {
	it('returns undefined for a position in prose (no cell)', async () => {
		const { provider, qmdModel } = setup(undefined, [fakeProvider({ title: 'x' })]);
		const result = await provider.provideCodeActions(qmdModel, new Range(2, 1, 2, 1), CONTEXT, CancellationToken.None);
		expect(result).toBeUndefined();
	});

	it('returns undefined on a chunk fence line', async () => {
		const { provider, qmdModel } = setup(CELL, [fakeProvider({ title: 'x' })]);
		// Line 4 is the opening fence: inside the cell span but not code.
		const result = await provider.provideCodeActions(qmdModel, new Range(4, 1, 4, 1), CONTEXT, CancellationToken.None);
		expect(result).toBeUndefined();
	});

	it('forwards into the cell and translates edits, diagnostics, and ranges back to document space', async () => {
		const action: CodeAction = {
			title: 'Fix it',
			diagnostics: [{ ...CELL_RANGE, severity: MarkerSeverity.Error, message: 'boom' }],
			ranges: [{ ...CELL_RANGE }],
			edit: { edits: [textEdit(CELL_URI, CELL_RANGE)] },
		};
		const { provider, qmdModel } = setup(CELL, [fakeProvider(action)]);

		const result = await provider.provideCodeActions(qmdModel, new Range(7, 1, 7, 4), CONTEXT, CancellationToken.None);

		const resolved = result!.actions[0];
		const edit = resolved.edit!.edits[0] as IWorkspaceTextEdit;
		expect({
			title: resolved.title,
			editResource: edit.resource.toString(),
			editRange: edit.textEdit.range,
			diagnosticRange: { ...resolved.diagnostics![0] },
			actionRange: resolved.ranges![0],
		}).toEqual({
			title: 'Fix it',
			editResource: DOC_URI.toString(),
			editRange: DOC_RANGE,
			diagnosticRange: { ...DOC_RANGE, severity: MarkerSeverity.Error, message: 'boom' },
			actionRange: DOC_RANGE,
		});
	});

	it('translates the cell-space edit filled in by resolveCodeAction back to document space', async () => {
		// Provide returns no edit; resolve fills it in cell space (the real flow).
		const action: CodeAction = { title: 'Resolve me' };
		const resolve = (a: CodeAction): CodeAction => {
			a.edit = { edits: [textEdit(CELL_URI, CELL_RANGE)] };
			return a;
		};
		const { provider, qmdModel } = setup(CELL, [fakeProvider(action, resolve)]);

		const result = await provider.provideCodeActions(qmdModel, new Range(7, 1, 7, 4), CONTEXT, CancellationToken.None);
		const resolved = await provider.resolveCodeAction(result!.actions[0], CancellationToken.None);

		const edit = resolved.edit!.edits[0] as IWorkspaceTextEdit;
		expect({ resource: edit.resource.toString(), range: edit.textEdit.range }).toEqual({
			resource: DOC_URI.toString(),
			range: DOC_RANGE,
		});
	});
});
