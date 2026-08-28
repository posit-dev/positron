/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { onUnexpectedExternalError } from '../../../../base/common/errors.js';
import { assertType } from '../../../../base/common/types.js';
import { URI } from '../../../../base/common/uri.js';
import { IRange, Range } from '../../../../editor/common/core/range.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { TextEdit } from '../../../../editor/common/languages.js';
import { ILanguageConfigurationService } from '../../../../editor/common/languages/languageConfigurationRegistry.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { IEditorWorkerService } from '../../../../editor/common/services/editorWorker.js';
import {
	getDocumentFormattingEditsUntilResult,
	getDocumentRangeFormattingEditsUntilResult,
} from '../../../../editor/contrib/format/browser/format.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { ILogService, LogLevel } from '../../../../platform/log/common/log.js';
import {
	editsWithinCell,
	IQuartoCellFormattingResult,
	resolveProtectedLineEdits,
	withoutNoOpEdits,
	withoutTrailingNewlineAtCellEnd,
} from '../common/quartoCellFormatting.js';
import { cellRangeToSource, ICellLineSpan, sourceRangeToCell } from '../common/quartoCellPositionMapping.js';
import { IQuartoVirtualCell, IQuartoVirtualNotebookService } from './quartoVirtualNotebookService.js';

/**
 * Everything about a cell that formatting it needs, copied before any request
 * goes out.
 *
 * A sync rebuilds the cells, so holding a cell across an await risks reading a
 * span that has moved or a model that has been disposed. The span is a copy; it
 * is not a guarantee, since an edit that leaves the chunk structure alone
 * updates it in place, and the next pass corrects whatever this one missed.
 */
interface ICellFormattingRequest {
	readonly textModel: ITextModel;
	readonly span: ICellLineSpan;
	/** The cell's text, for deciding whether the option lines survived. */
	readonly cellText: string;
	/**
	 * Lines the cell's span holds, which is what an edit has to fit inside. Not
	 * the model's line count: a chunk with no code has a span of no lines while
	 * its model still has one, and an edit on that line would map onto the
	 * closing fence.
	 */
	readonly spanLineCount: number;
	/** Last line of the model, and its end column, for the newline invariant. */
	readonly lastLineNumber: number;
	readonly lastLineMaxColumn: number;
	/** The cell language's line comment token, for finding its option lines. */
	readonly lineCommentToken: string | undefined;
}

/** What formatting one cell produced. */
type CellFormattingOutcome =
	| { readonly kind: 'edits'; readonly edits: TextEdit[] }
	/** The answer had to be rejected, which abandons the whole document format. */
	| { readonly kind: 'veto' }
	/** No formatter, nothing to change, or nothing left after the guards. */
	| { readonly kind: 'none' };

function noEdits(): IQuartoCellFormattingResult {
	return { edits: [], vetoedCells: 0 };
}

function snapshotCell(
	languageConfiguration: ILanguageConfigurationService,
	cell: IQuartoVirtualCell
): ICellFormattingRequest | undefined {
	const textModel = cell.textModel;
	if (textModel.isDisposed()) {
		// Reading a disposed model throws, and that would cost every other cell
		// its formatting rather than this one. The service drops such a cell on
		// its next sync.
		return undefined;
	}

	const lastLineNumber = textModel.getLineCount();
	const comments = languageConfiguration
		.getLanguageConfiguration(textModel.getLanguageId()).comments;

	return {
		textModel,
		span: { codeStartLine: cell.codeStartLine, codeEndLine: cell.codeEndLine },
		cellText: textModel.getValue(),
		spanLineCount: cell.codeEndLine - cell.codeStartLine + 1,
		lastLineNumber,
		lastLineMaxColumn: textModel.getLineMaxColumn(lastLineNumber),
		lineCommentToken: comments?.lineCommentToken,
	};
}

/**
 * Put one cell's answer through the guards, and map what survives into source
 * coordinates.
 *
 * Order matters. Every count and emptiness test runs after the drops, because a
 * guard that ran first would judge edits that are no longer there: the trailing
 * newline is removed before the bounds check, and the bounds check runs before
 * the option lines are considered.
 */
function resolveCellEdits(
	request: ICellFormattingRequest,
	rawEdits: TextEdit[] | undefined
): CellFormattingOutcome {
	if (!rawEdits || rawEdits.length === 0) {
		// No formatter for this language, or nothing it wanted to change. The
		// Quarto extension skips such a block silently and so do we.
		return { kind: 'none' };
	}

	if (request.spanLineCount <= 0) {
		// A chunk with no code. Anything offered for it would land on a fence,
		// and there is nothing in it to format, so drop rather than veto.
		return { kind: 'none' };
	}

	const trimmed = withoutTrailingNewlineAtCellEnd(
		withoutNoOpEdits(rawEdits), request.lastLineNumber, request.lastLineMaxColumn);

	if (!editsWithinCell(trimmed, request.spanLineCount)) {
		return { kind: 'veto' };
	}

	const resolved = resolveProtectedLineEdits(
		request.cellText, trimmed, request.lineCommentToken);
	if (resolved === undefined) {
		return { kind: 'veto' };
	}
	if (resolved.length === 0) {
		return { kind: 'none' };
	}

	// `eol` is dropped rather than carried over: it applies to a whole document,
	// so one cell's opinion of the line ending would retarget the source file.
	return {
		kind: 'edits',
		edits: resolved.map(edit => ({
			range: cellRangeToSource(request.span, edit.range),
			text: edit.text,
		})),
	};
}

/** Ask one cell's formatters, containing anything they throw. */
async function formatCell(
	languageFeatures: ILanguageFeaturesService,
	workerService: IEditorWorkerService,
	request: ICellFormattingRequest,
	token: CancellationToken
): Promise<TextEdit[] | undefined> {
	try {
		return await getDocumentFormattingEditsUntilResult(
			workerService,
			languageFeatures,
			request.textModel,
			// The cell model's own options, which `ModelService` resolves with the
			// language as the override identifier. That is the same answer the
			// Quarto extension computes by hand from the per-language settings.
			request.textModel.getFormattingOptions(),
			token
		);
	} catch (error) {
		// One cell's formatter failing must not cost the other cells theirs.
		onUnexpectedExternalError(error);
		return undefined;
	}
}

/**
 * Format every code cell of a Quarto document, answering in source coordinates.
 *
 * Exposed to extensions as `positron.executeQuartoCellFormattingProvider`, which
 * is how the Quarto extension formats chunks without writing a temporary file
 * per block. Core registers no formatting provider of its own: a second
 * formatter for `.qmd` would make `quarto.quarto` ambiguous, which turns an
 * explicit format into a "Configure Default Formatter" modal and makes
 * format-on-save do nothing at all.
 *
 * All or nothing, matching the extension: if any cell's answer has to be
 * rejected, nothing is returned and `vetoedCells` says how many. The message to
 * the user stays on the extension side, which already has one.
 */
export async function provideQuartoCellFormattingEdits(
	virtualNotebooks: IQuartoVirtualNotebookService,
	languageFeatures: ILanguageFeaturesService,
	languageConfiguration: ILanguageConfigurationService,
	workerService: IEditorWorkerService,
	logService: ILogService,
	uri: URI,
	token: CancellationToken
): Promise<IQuartoCellFormattingResult> {
	// Notebook creation is asynchronous, so a request arriving during creation
	// would otherwise see no cells at all.
	await virtualNotebooks.whenReady(uri);

	virtualNotebooks.ensureSynchronized(uri);

	const requests = virtualNotebooks.getCells(uri)
		.map(cell => snapshotCell(languageConfiguration, cell))
		.filter((request): request is ICellFormattingRequest => request !== undefined);

	if (token.isCancellationRequested) {
		return noEdits();
	}

	// Every cell at once. Each request is a round trip to a language server, so
	// a serial walk would cost their sum instead of the longest of them; on the
	// 45 chunks of posit-dev/positron#14512 that difference was 5049 ms to 63 ms.
	const answers = await Promise.all(requests.map(
		request => formatCell(languageFeatures, workerService, request, token)));

	// Cancelling cannot un-ask a request that already went out. What it must do
	// is keep a superseded pass from reaching the document.
	if (token.isCancellationRequested) {
		return noEdits();
	}

	const edits: TextEdit[] = [];
	let vetoedCells = 0;
	let answeredCells = 0;

	for (let index = 0; index < requests.length; index++) {
		const outcome = resolveCellEdits(requests[index], answers[index]);
		if (outcome.kind === 'veto') {
			vetoedCells++;
		} else if (outcome.kind === 'edits') {
			answeredCells++;
			edits.push(...outcome.edits);
		}
	}

	const tracing = logService.getLevel() === LogLevel.Trace;

	if (vetoedCells > 0) {
		if (tracing) {
			logService.trace(`[QuartoEmbedded] formatting vetoed by ${vetoedCells} cell(s)`);
		}
		return { edits: [], vetoedCells };
	}

	if (tracing) {
		logService.trace(`[QuartoEmbedded] formatting answered from ${answeredCells} of ` +
			`${requests.length} cell(s) with ${edits.length} edit(s)`);
	}

	return { edits, vetoedCells: 0 };
}

/**
 * Format the part of one code cell a range covers.
 *
 * Declines a range that leaves the cell, which covers a selection reaching a
 * fence, the prose around it, or a second chunk. The Quarto extension declines
 * the same cases today.
 */
export async function provideQuartoCellRangeFormattingEdits(
	virtualNotebooks: IQuartoVirtualNotebookService,
	languageFeatures: ILanguageFeaturesService,
	languageConfiguration: ILanguageConfigurationService,
	workerService: IEditorWorkerService,
	logService: ILogService,
	uri: URI,
	range: IRange,
	token: CancellationToken
): Promise<IQuartoCellFormattingResult> {
	await virtualNotebooks.whenReady(uri);

	virtualNotebooks.ensureSynchronized(uri);

	const cell = virtualNotebooks.getCellAtLine(uri, range.startLineNumber);
	if (!cell) {
		return noEdits();
	}

	const request = snapshotCell(languageConfiguration, cell);
	if (!request) {
		return noEdits();
	}

	const cellRange = sourceRangeToCell(request.span, range);
	if (!cellRange) {
		return noEdits();
	}

	if (token.isCancellationRequested) {
		return noEdits();
	}

	let rawEdits: TextEdit[] | undefined;
	try {
		rawEdits = await getDocumentRangeFormattingEditsUntilResult(
			workerService,
			languageFeatures,
			request.textModel,
			Range.lift(cellRange),
			request.textModel.getFormattingOptions(),
			token
		);
	} catch (error) {
		onUnexpectedExternalError(error);
		return noEdits();
	}

	if (token.isCancellationRequested) {
		return noEdits();
	}

	const outcome = resolveCellEdits(request, rawEdits);

	if (logService.getLevel() === LogLevel.Trace) {
		logService.trace(`[QuartoEmbedded] range formatting ${outcome.kind} for cell ` +
			`${request.span.codeStartLine}-${request.span.codeEndLine}`);
	}

	if (outcome.kind === 'veto') {
		return { edits: [], vetoedCells: 1 };
	}
	return outcome.kind === 'edits' ? { edits: outcome.edits, vetoedCells: 0 } : noEdits();
}

/**
 * Registered unconditionally, like `_executeQuartoCellSymbolProvider`. No
 * setting gate is needed: virtual notebooks only exist while
 * `quarto.embeddedLanguageFeatures.native` is on, so with the setting off there
 * are no cells and the answer is empty.
 */
CommandsRegistry.registerCommand('_executeQuartoCellFormattingProvider', async (accessor, ...args: [URI]) => {
	const [uri] = args;
	assertType(URI.isUri(uri));

	return await provideQuartoCellFormattingEdits(
		accessor.get(IQuartoVirtualNotebookService),
		accessor.get(ILanguageFeaturesService),
		accessor.get(ILanguageConfigurationService),
		accessor.get(IEditorWorkerService),
		accessor.get(ILogService),
		uri,
		CancellationToken.None
	);
});

CommandsRegistry.registerCommand('_executeQuartoCellRangeFormattingProvider', async (accessor, ...args: [URI, IRange]) => {
	const [uri, range] = args;
	assertType(URI.isUri(uri));
	assertType(Range.isIRange(range));

	return await provideQuartoCellRangeFormattingEdits(
		accessor.get(IQuartoVirtualNotebookService),
		accessor.get(ILanguageFeaturesService),
		accessor.get(ILanguageConfigurationService),
		accessor.get(IEditorWorkerService),
		accessor.get(ILogService),
		uri,
		range,
		CancellationToken.None
	);
});
