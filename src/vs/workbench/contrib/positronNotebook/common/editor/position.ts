/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
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
}
