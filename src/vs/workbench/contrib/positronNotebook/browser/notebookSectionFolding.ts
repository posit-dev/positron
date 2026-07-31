/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { derivedOpts, IObservable, observableValue } from '../../../../base/common/observable.js';
import { equals as arraysEqual } from '../../../../base/common/arrays.js';
import { getMarkdownHeadersInCell } from '../../notebook/browser/viewModel/foldingModel.js';
import { IPositronNotebookCell } from './PositronNotebookCells/IPositronNotebookCell.js';

/**
 * A foldable markdown header section. Collapsing the section hides the cells
 * at indexes `headerIndex + 1` through `endIndex` (inclusive); the header
 * cell itself stays visible.
 */
export interface ISectionRange {
	/** Index of the markdown header cell that heads the section. */
	headerIndex: number;
	/** Heading level (1-6) of the header cell. */
	level: number;
	/** Index of the last cell in the section (inclusive). Always > headerIndex. */
	endIndex: number;
}

/**
 * Heading level of a markdown cell for section folding purposes.
 * Matches upstream notebook folding: the minimum heading depth in the cell.
 * @returns The level (1-6), or undefined when the cell has no heading.
 */
export function getCellHeadingLevel(content: string): number | undefined {
	const minDepth = Math.min(7, ...Array.from(getMarkdownHeadersInCell(content), header => header.depth));
	return minDepth < 7 ? minDepth : undefined;
}

/**
 * Compute foldable header sections from per-cell heading levels.
 * A section headed by a cell with level L extends to the cell before the next
 * heading with level <= L, or to the end of the notebook. Sections with no
 * cells under them are omitted.
 * @param headingLevels One entry per cell: the heading level, or undefined for
 * cells that are not markdown headers.
 */
export function computeSectionRanges(headingLevels: readonly (number | undefined)[]): ISectionRange[] {
	// Collect header cells in notebook order.
	const headers: { index: number; level: number }[] = [];
	for (let i = 0; i < headingLevels.length; i++) {
		const level = headingLevels[i];
		if (level !== undefined) {
			headers.push({ index: i, level });
		}
	}

	// Each section ends before the next same-or-higher-level header.
	const ranges: ISectionRange[] = [];
	for (let i = 0; i < headers.length; i++) {
		const header = headers[i];
		let endIndex = headingLevels.length - 1;
		for (let j = i + 1; j < headers.length; j++) {
			if (headers[j].level <= header.level) {
				endIndex = headers[j].index - 1;
				break;
			}
		}
		if (endIndex > header.index) {
			ranges.push({ headerIndex: header.index, level: header.level, endIndex });
		}
	}
	return ranges;
}

/** Structural equality for derived section ranges, to avoid spurious re-renders. */
function sectionRangesEqual(a: ISectionRange[], b: ISectionRange[]): boolean {
	return arraysEqual(a, b, (x, y) =>
		x.headerIndex === y.headerIndex && x.level === y.level && x.endIndex === y.endIndex);
}

/** Set equality for derived hidden-cell sets, to avoid spurious re-renders. */
function handleSetsEqual(a: ReadonlySet<number>, b: ReadonlySet<number>): boolean {
	if (a.size !== b.size) {
		return false;
	}
	for (const handle of a) {
		if (!b.has(handle)) {
			return false;
		}
	}
	return true;
}

/**
 * Fold state for markdown header sections in a Positron notebook.
 *
 * Sections are derived from the notebook's cells (and each markdown cell's
 * content), so they recompute automatically when cells are added, removed,
 * reordered, or edited. Collapse state is keyed by cell handle: a collapsed
 * header whose section disappears (heading removed, header deleted) simply
 * stops hiding cells, and hidden cells always reappear.
 *
 * Folding is purely a view concern -- hidden cells stay in the model, so
 * operations like Run All still execute them.
 */
export class NotebookSectionFoldingModel {
	/** Handles of header cells the user has collapsed. */
	private readonly _collapsedHandles = observableValue<ReadonlySet<number>>('collapsedSectionHandles', new Set());

	/** Handles of header cells the user has collapsed. */
	readonly collapsedHandles: IObservable<ReadonlySet<number>> = this._collapsedHandles;

	/** Foldable header sections, in notebook order. */
	readonly sectionRanges: IObservable<ISectionRange[]>;

	/** Handles of cells hidden inside collapsed sections. */
	readonly hiddenCellHandles: IObservable<ReadonlySet<number>>;

	constructor(private readonly _cells: IObservable<IPositronNotebookCell[]>) {
		this.sectionRanges = derivedOpts({ debugName: 'sectionRanges', equalsFn: sectionRangesEqual }, reader => {
			const cells = this._cells.read(reader);
			const headingLevels = cells.map(cell => {
				if (!cell.isMarkdownCell()) {
					return undefined;
				}
				const content = cell.markdownString.read(reader) ?? '';
				return getCellHeadingLevel(content);
			});
			return computeSectionRanges(headingLevels);
		});

		this.hiddenCellHandles = derivedOpts({ debugName: 'hiddenCellHandles', equalsFn: handleSetsEqual }, reader => {
			const cells = this._cells.read(reader);
			const ranges = this.sectionRanges.read(reader);
			const collapsed = this._collapsedHandles.read(reader);
			const hidden = new Set<number>();
			for (const range of ranges) {
				if (!collapsed.has(cells[range.headerIndex].handle)) {
					continue;
				}
				for (let i = range.headerIndex + 1; i <= range.endIndex; i++) {
					hidden.add(cells[i].handle);
				}
			}
			return hidden;
		});
	}

	/**
	 * @returns The section headed by the given cell, or undefined when the cell
	 * is not a foldable header.
	 */
	getSectionRange(cell: IPositronNotebookCell): ISectionRange | undefined {
		return this.sectionRanges.get().find(range => range.headerIndex === cell.index);
	}

	/** Whether the given header cell's section is collapsed. */
	isSectionCollapsed(cell: IPositronNotebookCell): boolean {
		return this._collapsedHandles.get().has(cell.handle) && this.getSectionRange(cell) !== undefined;
	}

	/** Whether the given cell is hidden inside a collapsed section. */
	isCellHidden(cell: IPositronNotebookCell): boolean {
		return this.hiddenCellHandles.get().has(cell.handle);
	}

	/** Collapse or expand the section headed by the given cell. */
	setSectionCollapsed(cell: IPositronNotebookCell, collapsed: boolean): void {
		// Ignore cells that don't head a foldable section.
		if (collapsed && this.getSectionRange(cell) === undefined) {
			return;
		}
		const handles = new Set(this._collapsedHandles.get());
		if (collapsed) {
			handles.add(cell.handle);
		} else {
			handles.delete(cell.handle);
		}
		this._collapsedHandles.set(handles, undefined);
	}

	/** Toggle the collapse state of the section headed by the given cell. */
	toggleSectionCollapsed(cell: IPositronNotebookCell): void {
		this.setSectionCollapsed(cell, !this.isSectionCollapsed(cell));
	}

	/** Expand every collapsed section containing the given cell so it becomes visible. */
	revealCell(cell: IPositronNotebookCell): void {
		if (!this.isCellHidden(cell)) {
			return;
		}
		const cells = this._cells.get();
		const index = cell.index;
		const handles = new Set(this._collapsedHandles.get());
		for (const range of this.sectionRanges.get()) {
			if (range.headerIndex < index && index <= range.endIndex) {
				handles.delete(cells[range.headerIndex].handle);
			}
		}
		this._collapsedHandles.set(handles, undefined);
	}
}
