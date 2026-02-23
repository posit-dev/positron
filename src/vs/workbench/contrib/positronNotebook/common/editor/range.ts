/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import { IRange, Range } from '../../../../../editor/common/core/range.js';
import { ICellEditorPosition, CellEditorPosition } from './position.js';

/** A range in a cell editor. */
export interface ICellEditorRange {
	cellIndex: number;
	range: IRange;
}

export class CellEditorRange implements ICellEditorRange {
	constructor(
		public readonly cellIndex: number,
		public readonly range: Range
	) { }

	containsPosition(cellPosition: ICellEditorPosition): boolean {
		return CellEditorRange.containsPosition(this, cellPosition);
	}

	public static containsPosition(cellRange: ICellEditorRange, cellPosition: ICellEditorPosition): boolean {
		return cellRange.cellIndex === cellPosition.cellIndex && Range.containsPosition(cellRange.range, cellPosition.position);
	}

	getStartPosition(): CellEditorPosition {
		return CellEditorRange.getStartPosition(this);
	}

	public static getStartPosition(range: ICellEditorRange): CellEditorPosition {
		return new CellEditorPosition(range.cellIndex, Range.getStartPosition(range.range));
	}

	getEndPosition(): CellEditorPosition {
		return CellEditorRange.getEndPosition(this);
	}

	public static getEndPosition(range: ICellEditorRange): CellEditorPosition {
		return new CellEditorPosition(range.cellIndex, Range.getEndPosition(range.range));
	}

	equalsRange(other: ICellEditorRange | null | undefined): boolean {
		return CellEditorRange.equalsRange(this, other);
	}

	public static equalsRange(a: ICellEditorRange | null | undefined, b: ICellEditorRange | null | undefined): boolean {
		if (!a && !b) {
			return true;
		}
		return (
			!!a &&
			!!b &&
			a.cellIndex === b.cellIndex &&
			Range.equalsRange(a.range, b.range)
		);
	}

	isEmpty(): boolean {
		return CellEditorRange.isEmpty(this);
	}

	public static isEmpty(cellRange: ICellEditorRange): boolean {
		return Range.isEmpty(cellRange.range);
	}

	containsRange(other: ICellEditorRange): boolean {
		return CellEditorRange.containsRange(this, other);
	}

	public static containsRange(cellRange: ICellEditorRange, otherCellRange: ICellEditorRange): boolean {
		return cellRange.cellIndex === otherCellRange.cellIndex && Range.containsRange(cellRange.range, otherCellRange.range);
	}

	isBefore(other: ICellEditorRange): boolean {
		return CellEditorRange.isBefore(this, other);
	}

	public static isBefore(a: ICellEditorRange, b: ICellEditorRange): boolean {
		return CellEditorPosition.isBefore(
			CellEditorRange.getStartPosition(a),
			CellEditorRange.getStartPosition(b),
		);
	}

	toString(): string {
		return CellEditorRange.toString(this);
	}

	public static toString(cellRange: ICellEditorRange): string {
		return `cell[${cellRange.cellIndex}]:[${cellRange.range.startLineNumber},${cellRange.range.startColumn} -> ${cellRange.range.endLineNumber},${cellRange.range.endColumn}]`;
	}
}
