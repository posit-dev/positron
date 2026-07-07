/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { URI } from '../../../../../base/common/uri.js';
import { Position } from '../../../../../editor/common/core/position.js';
import { ITextModel } from '../../../../../editor/common/model.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { LanguageRuntimeSessionMode } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession, IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { IPositronVariablesInstance } from '../../../../services/positronVariables/common/interfaces/positronVariablesInstance.js';
import { IPositronVariablesService } from '../../../../services/positronVariables/common/interfaces/positronVariablesService.js';
import { IVariableItem } from '../../../../services/positronVariables/common/interfaces/variableItem.js';
import { IViewsService } from '../../../../services/views/common/viewsService.js';
import { Event } from '../../../../../base/common/event.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { PositronDataExplorerCommandId } from '../../browser/positronDataExplorerActions.js';
import { PositronDataExplorerClickToViewContribution } from '../../browser/positronDataExplorerClickToViewProvider.js';

const SESSION_ID = 'test-session-id';
const RSTUDIO_KEYBINDINGS_SETTING = 'workbench.keybindings.rstudioKeybindings';

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

describe('PositronDataExplorerClickToViewContribution', () => {
	let session: ILanguageRuntimeSession | undefined;
	let variablesInstances: IPositronVariablesInstance[];
	let rstudioKeybindingsEnabled: boolean;
	let openViewStub: ReturnType<typeof vi.fn<(...args: unknown[]) => Promise<unknown>>>;
	let executeCommandStub: ReturnType<typeof vi.fn<(...args: unknown[]) => Promise<unknown>>>;
	const disposables = new DisposableStore();

	const ctx = createTestContainer()
		.stub(ICommandService, {
			executeCommand: (...args: unknown[]) => executeCommandStub(...args),
		})
		.stub(IConfigurationService, {
			getValue: (key: string) => key === RSTUDIO_KEYBINDINGS_SETTING ? rstudioKeybindingsEnabled : undefined,
		})
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
		rstudioKeybindingsEnabled = true;
		openViewStub = vi.fn().mockResolvedValue(null);
		executeCommandStub = vi.fn().mockResolvedValue(undefined);
	});

	afterEach(() => {
		disposables.clear();
	});

	const handleClick = (model: ITextModel) => {
		const provider = disposables.add(ctx.instantiationService.createInstance(PositronDataExplorerClickToViewContribution));
		return provider.handleClick(model, new Position(1, 1));
	};

	it('opens the data frame and skips go-to-definition when the symbol is a viewable data frame', async () => {
		const handled = await handleClick(makeModel({ word: 'df' }));

		expect(handled).toBe(true);
		expect(executeCommandStub).toHaveBeenCalledWith(
			PositronDataExplorerCommandId.ViewDataFrameByVariableAction,
			{ sessionId: SESSION_ID, variableId: 'item-id' },
		);
	});

	it('falls through to go-to-definition when the RStudio keymap is off', async () => {
		rstudioKeybindingsEnabled = false;

		const handled = await handleClick(makeModel({ word: 'df' }));

		expect(handled).toBe(false);
		expect(executeCommandStub).not.toHaveBeenCalled();
	});

	it('falls through without running the command when the symbol is not a viewable data frame', async () => {
		const handled = await handleClick(makeModel({ word: 'missing' }));

		expect(handled).toBe(false);
		expect(executeCommandStub).not.toHaveBeenCalled();
	});

	it('falls through when resolution throws, so a failure never breaks go-to-definition', async () => {
		// eslint-disable-next-line local/code-no-dangerous-type-assertions -- model whose word lookup throws
		const throwingModel = {
			uri: URI.parse('file:///test.R'),
			getWordAtPosition: () => { throw new Error('boom'); },
			getLanguageIdAtPosition: () => 'r',
		} as unknown as ITextModel;

		const handled = await handleClick(throwingModel);

		expect(handled).toBe(false);
		expect(executeCommandStub).not.toHaveBeenCalled();
	});
});
