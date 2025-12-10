/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
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
}
