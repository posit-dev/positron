/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { URI } from '../../../../../base/common/uri.js';
import { Range } from '../../../../../editor/common/core/range.js';
import { ITextModel } from '../../../../../editor/common/model.js';
import { CodeActionContext, CodeActionTriggerType } from '../../../../../editor/common/languages.js';
import { CodeActionKind } from '../../../../../editor/contrib/codeAction/common/types.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { LanguageRuntimeSessionMode } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession, IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { IPositronVariablesInstance } from '../../../../services/positronVariables/common/interfaces/positronVariablesInstance.js';
import { IPositronVariablesService } from '../../../../services/positronVariables/common/interfaces/positronVariablesService.js';
import { IVariableItem } from '../../../../services/positronVariables/common/interfaces/variableItem.js';
import { IViewsService } from '../../../../services/views/common/viewsService.js';
import { Event } from '../../../../../base/common/event.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { PositronDataExplorerCommandId } from '../../browser/positronDataExplorerActions.js';
import { PositronDataExplorerCodeActionProvider } from '../../browser/positronDataExplorerCodeActionProvider.js';

const SESSION_ID = 'test-session-id';

// Test doubles below use `as unknown as <Service>` because the services have
// large surface areas we don't exercise. Disabling the rule locally keeps the
// helpers readable; the trade-off is that a real missing field won't be caught
// by the compiler -- acceptable for tightly scoped unit tests.
/* eslint-disable local/code-no-dangerous-type-assertions */
const makeSession = (languageId: string, sessionId = SESSION_ID): ILanguageRuntimeSession =>
({
	sessionId,
	runtimeMetadata: { languageId },
	metadata: { sessionMode: LanguageRuntimeSessionMode.Console },
} as unknown as ILanguageRuntimeSession);

const makeModel = (options: { word?: string; languageIdAtPosition?: string; uri?: URI } = {}): ITextModel => {
	const { word, languageIdAtPosition = 'r', uri = URI.parse('file:///test.R') } = options;
	return {
		uri,
		getWordAtPosition: vi.fn().mockReturnValue(word ? { word, startColumn: 1, endColumn: word.length + 1 } : null),
		getLanguageIdAtPosition: () => languageIdAtPosition,
	} as unknown as ITextModel;
};

const makeVariableItem = (overrides: Partial<IVariableItem> = {}): IVariableItem =>
({
	id: 'item-id',
	path: [],
	hasViewer: true,
	displayName: 'df',
	view: vi.fn().mockResolvedValue(undefined),
	...overrides,
} as unknown as IVariableItem);

const makeVariablesInstance = (items: IVariableItem[], sessionId = SESSION_ID): IPositronVariablesInstance =>
({
	session: { sessionId },
	variableItems: items,
	onDidChangeEntries: Event.None,
} as unknown as IPositronVariablesInstance);
/* eslint-enable local/code-no-dangerous-type-assertions */

describe('PositronDataExplorerCodeActionProvider', () => {
	let session: ILanguageRuntimeSession | undefined;
	let variablesInstances: IPositronVariablesInstance[];
	let openViewStub: ReturnType<typeof vi.fn<(...args: unknown[]) => Promise<unknown>>>;

	const ctx = createTestContainer()
		.stub(ILanguageService, {
			getLanguageName: (id: string) => id === 'r' ? 'R' : id === 'python' ? 'Python' : null,
		})
		.stub(IRuntimeSessionService, {
			getConsoleSessionForLanguage: () => session,
			getNotebookSessionForNotebookUri: () => undefined,
			get activeSessions() { return []; },
		})
		.stub(IPositronVariablesService, {
			get positronVariablesInstances() { return variablesInstances; },
		})
		.stub(IViewsService, {
			openView: (...args: unknown[]) => openViewStub(...args),
		})
		.build();

	beforeEach(() => {
		session = makeSession('r');
		variablesInstances = [makeVariablesInstance([makeVariableItem({ displayName: 'df' })])];
		openViewStub = vi.fn().mockResolvedValue(null);
	});

	const provide = (model: ITextModel, context?: Partial<CodeActionContext>) => {
		const provider = ctx.instantiationService.createInstance(PositronDataExplorerCodeActionProvider);
		return provider.provideCodeActions(
			model,
			new Range(1, 1, 1, 1),
			{ trigger: CodeActionTriggerType.Auto, ...context },
			// eslint-disable-next-line local/code-no-dangerous-type-assertions -- minimal cancellation token stub
			{ isCancellationRequested: false, onCancellationRequested: Event.None } as unknown as Parameters<PositronDataExplorerCodeActionProvider['provideCodeActions']>[3],
		);
	};

	it('offers "Open in Data Explorer" with the resolved variable command when the symbol is a viewable data frame', async () => {
		const result = await provide(makeModel({ word: 'df' }));

		expect(result?.actions).toMatchObject([
			{
				title: `Open 'df' in Data Explorer`,
				kind: CodeActionKind.Refactor.value,
				command: {
					id: PositronDataExplorerCommandId.ViewDataFrameByVariableAction,
					arguments: [{ sessionId: SESSION_ID, variableId: 'item-id' }],
				},
			},
		]);
	});

	it('offers nothing when the symbol is not a known variable', async () => {
		const result = await provide(makeModel({ word: 'missing' }));

		expect(result).toBeUndefined();
	});

	it('offers nothing when the symbol exists but is not viewable', async () => {
		variablesInstances = [makeVariablesInstance([makeVariableItem({ displayName: 'df', hasViewer: false })])];

		const result = await provide(makeModel({ word: 'df' }));

		expect(result).toBeUndefined();
	});

	it('offers nothing when the request is scoped to an unrelated kind', async () => {
		const result = await provide(makeModel({ word: 'df' }), { only: CodeActionKind.SourceFixAll.value });

		expect(result).toBeUndefined();
	});

	it('does not open the Variables view or wait when computing actions (no side effects, no hang)', async () => {
		// An instance exists but has no variables yet, and its change event never
		// fires. A waiting resolver would hang; the provider must return promptly.
		variablesInstances = [makeVariablesInstance([])];

		const result = await provide(makeModel({ word: 'df' }));

		expect(result).toBeUndefined();
		expect(openViewStub).not.toHaveBeenCalled();
	});
});
