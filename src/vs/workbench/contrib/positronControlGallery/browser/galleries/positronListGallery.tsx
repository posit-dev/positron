/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './positronListGallery.css';

// React.
import { useEffect, useState } from 'react';

// Other dependencies.
import { PositronList } from '../../../../browser/positronList/positronList.js';
import { ListEntry, PositronListInstance } from '../../../../browser/positronList/classes/positronListInstance.js';
import { SelectionCursorOptions } from '../../../../browser/positronDataGrid/classes/dataGridInstance.js';
import { controlGalleryRegistry } from '../controlGalleryRegistry.js';

const DEFAULT_ITEM_HEIGHT = 24;
const DEFAULT_SECTION_HEIGHT = 32;

/**
 * Builds the entries array for the harness. When sectionCount is 0 the entries are flat;
 * otherwise items are distributed evenly across that many section headers.
 */
const buildEntries = (itemCount: number, sectionCount: number): ListEntry<string, string>[] => {
	const entries: ListEntry<string, string>[] = [];

	if (sectionCount === 0) {
		for (let i = 0; i < itemCount; i++) {
			entries.push({ kind: 'item', item: `Item ${i + 1}` });
		}
		return entries;
	}

	const itemsPerSection = Math.ceil(itemCount / sectionCount);
	for (let s = 0; s < sectionCount; s++) {
		entries.push({ kind: 'section', section: `Section ${s + 1}` });
		const start = s * itemsPerSection;
		const end = Math.min(start + itemsPerSection, itemCount);
		for (let i = start; i < end; i++) {
			entries.push({ kind: 'item', item: `Item ${i + 1}` });
		}
	}
	return entries;
};

/**
 * PositronListHarness component. A configurable fixture for working on PositronList. The
 * instance is created once and entries are pushed in when the knobs change, per the
 * data-grid pattern (instance is the API surface; no React wrapper mediating props).
 */
const PositronListHarness = () => {
	const [itemCount, setItemCount] = useState(100);
	const [sectionCount, setSectionCount] = useState(0);
	const [selectionFollowsCursor, setSelectionFollowsCursor] = useState(false);

	// selectionFollowsCursor is a construction-time option, so the instance is recreated when it
	// toggles. When the selection follows the cursor, Enter/Space-to-select are redundant and
	// disallowed; otherwise opt them in. Entries are (re)applied by the effect below, which runs
	// whenever the instance changes.
	const [instance, setInstance] = useState<PositronListInstance<string, string> | undefined>(undefined);

	useEffect(() => {
		const cursorOptions: SelectionCursorOptions = selectionFollowsCursor
			? { selectionFollowsCursor: true }
			: { selectionFollowsCursor: false, enterSelects: true, spaceSelects: true };

		const list = new PositronListInstance<string, string>({
			itemRenderer: item => <div className='positron-list-harness-item'>{item}</div>,
			sectionRenderer: section => <div className='positron-list-harness-section'>{section}</div>,
			itemHeight: DEFAULT_ITEM_HEIGHT,
			sectionHeight: DEFAULT_SECTION_HEIGHT,
			...cursorOptions,
		});
		setInstance(list);
		return () => list.dispose();
	}, [selectionFollowsCursor]);

	useEffect(() => {
		instance?.setEntries(buildEntries(itemCount, sectionCount));
	}, [instance, itemCount, sectionCount]);

	if (instance === undefined) {
		return null;
	}

	return (
		<div className='positron-list-harness'>
			<div className='positron-list-harness-toolbar'>
				<label className='positron-list-harness-knob'>
					<span>Items</span>
					<input
						max={100000}
						min={0}
						type='number'
						value={itemCount}
						onChange={e => setItemCount(Math.max(0, Number(e.target.value) || 0))}
					/>
				</label>
				<label className='positron-list-harness-knob'>
					<span>Sections</span>
					<input
						max={1000}
						min={0}
						type='number'
						value={sectionCount}
						onChange={e => setSectionCount(Math.max(0, Number(e.target.value) || 0))}
					/>
				</label>
				<label className='positron-list-harness-knob positron-list-harness-checkbox'>
					<input
						checked={selectionFollowsCursor}
						type='checkbox'
						onChange={e => setSelectionFollowsCursor(e.target.checked)}
					/>
					<span>Selection follows cursor</span>
				</label>
				<div className='positron-list-harness-stats'>
					{itemCount} items{sectionCount > 0 ? ` across ${sectionCount} sections` : ''}
				</div>
			</div>
			<div className='positron-list-harness-preview'>
				<PositronList instance={instance} />
			</div>
		</div>
	);
};

controlGalleryRegistry.register({
	id: 'positronList',
	label: 'Positron List',
	description: 'Single-column virtualized list with optional section headers.',
	render: () => <PositronListHarness />
});
