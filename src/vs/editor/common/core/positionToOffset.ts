/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { findLastIdxMonotonous } from '../../../base/common/arraysFind.js';
import { ITextModel } from '../model.js';
import { OffsetEdit, SingleOffsetEdit } from './offsetEdit.js';
import { OffsetRange } from './offsetRange.js';
import { Position } from './position.js';
import { Range } from './range.js';
import { SingleTextEdit, TextEdit } from './textEdit.js';
import { TextLength } from './textLength.js';

export abstract class PositionOffsetTransformerBase {
	abstract getOffset(position: Position): number;

	getOffsetRange(range: Range): OffsetRange {
		return new OffsetRange(
			this.getOffset(range.getStartPosition()),
			this.getOffset(range.getEndPosition())
		);
	}

	abstract getPosition(offset: number): Position;

	getRange(offsetRange: OffsetRange): Range {
		return Range.fromPositions(
			this.getPosition(offsetRange.start),
			this.getPosition(offsetRange.endExclusive)
		);
	}

	getOffsetEdit(edit: TextEdit): OffsetEdit {
		const edits = edit.edits.map(e => this.getSingleOffsetEdit(e));
		return new OffsetEdit(edits);
	}

	getSingleOffsetEdit(edit: SingleTextEdit): SingleOffsetEdit {
		return new SingleOffsetEdit(this.getOffsetRange(edit.range), edit.text);
	}

	getSingleTextEdit(edit: SingleOffsetEdit): SingleTextEdit {
		return new SingleTextEdit(this.getRange(edit.replaceRange), edit.newText);
	}

	getTextEdit(edit: OffsetEdit): TextEdit {
		const edits = edit.edits.map(e => this.getSingleTextEdit(e));
		return new TextEdit(edits);
	}
}

export class PositionOffsetTransformer extends PositionOffsetTransformerBase {
	private readonly lineStartOffsetByLineIdx: number[];
	private readonly lineEndOffsetByLineIdx: number[];

	constructor(public readonly text: string) {
		super();

		this.lineStartOffsetByLineIdx = [];
		this.lineEndOffsetByLineIdx = [];

		this.lineStartOffsetByLineIdx.push(0);
		for (let i = 0; i < text.length; i++) {
			if (text.charAt(i) === '\n') {
				this.lineStartOffsetByLineIdx.push(i + 1);
				if (i > 0 && text.charAt(i - 1) === '\r') {
					this.lineEndOffsetByLineIdx.push(i - 1);
				} else {
					this.lineEndOffsetByLineIdx.push(i);
				}
			}
		}
		this.lineEndOffsetByLineIdx.push(text.length);
	}

	override getOffset(position: Position): number {
		const valPos = this._validatePosition(position);
		return this.lineStartOffsetByLineIdx[valPos.lineNumber - 1] + valPos.column - 1;
	}

	private _validatePosition(position: Position): Position {
		if (position.lineNumber < 1) {
			return new Position(1, 1);
		}
		const lineCount = this.textLength.lineCount + 1;
		if (position.lineNumber > lineCount) {
			const lineLength = this.getLineLength(lineCount);
			return new Position(lineCount, lineLength + 1);
		}
		if (position.column < 1) {
			return new Position(position.lineNumber, 1);
		}
		const lineLength = this.getLineLength(position.lineNumber);
		if (position.column - 1 > lineLength) {
			return new Position(position.lineNumber, lineLength + 1);
		}
		return position;
	}

	override getPosition(offset: number): Position {
		const idx = findLastIdxMonotonous(this.lineStartOffsetByLineIdx, i => i <= offset);
		const lineNumber = idx + 1;
		const column = offset - this.lineStartOffsetByLineIdx[idx] + 1;
		return new Position(lineNumber, column);
	}

	getTextLength(offsetRange: OffsetRange): TextLength {
		return TextLength.ofRange(this.getRange(offsetRange));
	}

	get textLength(): TextLength {
		const lineIdx = this.lineStartOffsetByLineIdx.length - 1;
		return new TextLength(lineIdx, this.text.length - this.lineStartOffsetByLineIdx[lineIdx]);
	}

	getLineLength(lineNumber: number): number {
		return this.lineEndOffsetByLineIdx[lineNumber - 1] - this.lineStartOffsetByLineIdx[lineNumber - 1];
	}
}

export function getPositionOffsetTransformerFromTextModel(textModel: ITextModel): PositionOffsetTransformerBase {
	return new PositionOffsetTransformerWithTextModel(textModel);
}

class PositionOffsetTransformerWithTextModel extends PositionOffsetTransformerBase {
	constructor(private readonly _textModel: ITextModel) {
		super();
	}

	override getOffset(position: Position): number {
		return this._textModel.getOffsetAt(position);
	}

	override getPosition(offset: number): Position {
		return this._textModel.getPositionAt(offset);
	}
}
