/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationError } from '../../../../../base/common/errors.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Position } from '../../../../../editor/common/core/position.js';
import { Range } from '../../../../../editor/common/core/range.js';
import { Selection } from '../../../../../editor/common/core/selection.js';
import { IEditor } from '../../../../../editor/common/editorCommon.js';
import { IStatementRange, StatementRangeKind, StatementRangeProvider } from '../../../../../editor/common/languages.js';
import { ITextModel } from '../../../../../editor/common/model.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { ILanguageFeaturesService } from '../../../../../editor/common/services/languageFeatures.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { createTextModel } from '../../../../../editor/test/common/testTextModel.js';
import { CommandsRegistry } from '../../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { ILogService, NullLogService } from '../../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { TestNotificationService } from '../../../../../platform/notification/test/common/testNotificationService.js';
import { createLightTestContainer } from '../../../../../test/vitest/lightTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IPositronConsoleService } from '../../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { ITextFileService } from '../../../../services/textfile/common/textfiles.js';
import { IDebugService } from '../../../debug/common/debug.js';
import { registerPositronConsoleActions } from '../../browser/positronConsoleActions.js';
import { IEditorCodeSubmissionService, IStatementRangeDetection } from '../../browser/editorCodeSubmission/editorCodeSubmissionService.js';

const EXECUTE_CODE_COMMAND_ID = 'workbench.action.positronConsole.executeCode';

// Register the Console actions once so that the Execute Code command exists.
registerPositronConsoleActions();

// Three statements: line 1, lines 3-5, and line 7.
const SQL = [
	'SELECT 1 AS first_stmt;',
	'',
	'SELECT name, price',
	'FROM fruit',
	'WHERE price > 1;',
	'',
	'SELECT 3 AS third_stmt;',
].join('\n');

/**
 * A statement range provider that knows the three statements in `SQL`. A blank
 * line resolves to the statement that follows it.
 */
const statementRangeProvider: StatementRangeProvider = {
	provideStatementRange(model: ITextModel, position: Position): IStatementRange {
		const line = position.lineNumber;
		const range = line <= 1 ? new Range(1, 1, 1, 24) :
			line <= 5 ? new Range(3, 1, 5, 17) :
				new Range(7, 1, 7, 24);
		return { kind: StatementRangeKind.Success, range };
	}
};

/** A minimal editor that tracks its cursor and selection. */
function createFakeEditor(model: ITextModel, start: Position) {
	let selection = Selection.fromPositions(start);
	return stubInterface<IEditor>({
		getModel: () => model,
		getPosition: () => selection.getPosition(),
		getSelection: () => selection,
		setPosition: (position) => { selection = Selection.fromPositions(Position.lift(position)); },
		setSelection: (s: Selection) => { selection = Selection.liftSelection(s); },
		revealPositionInCenterIfOutsideViewport: () => { },
	});
}

describe('Execute Code action', () => {
	const executeCode = vi.fn<IPositronConsoleService['executeCode']>();
	const editorService = { activeTextEditorControl: undefined as IEditor | undefined, activeTextEditorLanguageId: 'sql' };

	const ctx = createLightTestContainer()
		.stub(IEditorService, editorService)
		.stub(ILanguageFeaturesService, { statementRangeProvider: { all: () => [statementRangeProvider] } })
		.stub(ILanguageService, { getLanguageName: () => 'SQL' })
		.stub(ILogService, new NullLogService())
		.stub(IModelService, {})
		.stub(INotificationService, new TestNotificationService())
		.stub(IPositronConsoleService, { executeCode })
		.stub(IDebugService, {})
		.stub(ITextFileService, { isDirty: () => false })
		.stub(IConfigurationService, new TestConfigurationService())
		.stub(IEditorCodeSubmissionService, {
			beginStatementRangeDetection: () => stubInterface<IStatementRangeDetection>({
				token: CancellationToken.None,
				wait: async <T>(work: Promise<T>) => ({ kind: 'result' as const, value: await work }),
				dispose: () => { },
			}),
		})
		.build();

	async function runExecuteCode(editor: IEditor) {
		editorService.activeTextEditorControl = editor;
		const handler = CommandsRegistry.getCommand(EXECUTE_CODE_COMMAND_ID)!.handler;
		return ctx.instantiationService.invokeFunction(handler, {});
	}

	it('moves the cursor to the next statement after the code runs', async () => {
		const model = ctx.disposables.add(createTextModel(SQL));
		const editor = createFakeEditor(model, new Position(1, 1));
		executeCode.mockResolvedValue('session-1');

		await runExecuteCode(editor);

		expect(executeCode).toHaveBeenCalledOnce();
		expect(editor.getPosition()).toEqual(new Position(3, 1));
	});

	it('leaves the cursor where it was when the execution session provider declines', async () => {
		const model = ctx.disposables.add(createTextModel(SQL));
		const editor = createFakeEditor(model, new Position(1, 1));
		executeCode.mockRejectedValue(new CancellationError());

		const nextPosition = await runExecuteCode(editor);

		expect(editor.getPosition()).toEqual(new Position(1, 1));
		expect(nextPosition).toBeUndefined();
	});

	it('keeps the cursor where the user moved it while the provider was busy', async () => {
		const model = ctx.disposables.add(createTextModel(SQL));
		const editor = createFakeEditor(model, new Position(1, 1));
		executeCode.mockImplementation(async () => {
			// The user moves the cursor while the provider waits for a connection.
			editor.setPosition(new Position(7, 1));
			throw new CancellationError();
		});

		await runExecuteCode(editor);

		expect(editor.getPosition()).toEqual(new Position(7, 1));
	});
});
