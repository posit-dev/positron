/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import { IPosition, Position } from '../../../../../editor/common/core/position.js';


/** A position in a cell editor. */
export interface ICellEditorPosition {
	cellIndex: number;
	position: IPosition;
}

export class CellEditorPosition implements ICellEditorPosition {
	constructor(
		public readonly cellIndex: number,
		public readonly position: IPosition
	) { }

	equals(other: ICellEditorPosition): boolean {
		return CellEditorPosition.equals(this, other);
	}

	public static equals(a: ICellEditorPosition | null, b: ICellEditorPosition | null): boolean {
		if (!a && !b) {
			return true;
		}
		return (
			!!a &&
			!!b &&
			a.cellIndex === b.cellIndex &&
			Position.equals(a.position, b.position)
		);
	}

	isBefore(other: ICellEditorPosition): boolean {
		return CellEditorPosition.isBefore(this, other);
	}

	public static isBefore(a: ICellEditorPosition, b: ICellEditorPosition): boolean {
		if (a.cellIndex < b.cellIndex) {
			return true;
		}
		if (a.cellIndex > b.cellIndex) {
			return false;
		}
		return Position.isBefore(a.position, b.position);
	}

	isBeforeOrEqual(other: ICellEditorPosition): boolean {
		return CellEditorPosition.isBeforeOrEqual(this, other);
	}

	public static isBeforeOrEqual(a: ICellEditorPosition, b: ICellEditorPosition): boolean {
		if (a.cellIndex < b.cellIndex) {
			return true;
		}
		if (a.cellIndex > b.cellIndex) {
			return false;
		}
		if (Position.isBeforeOrEqual(a.position, b.position)) {
			return true;
		}
		return false;
	}

	toString(): string {
		return CellEditorPosition.toString(this);
	}

	public static toString(cellPosition: ICellEditorPosition): string {
		return `cell[${cellPosition.cellIndex}]:(${cellPosition.position.lineNumber},${cellPosition.position.column})`;
	}
}
