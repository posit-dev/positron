/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './CellTagsBar.css';

// React.
import React from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { Icon } from '../../../../../platform/positronActionBar/browser/components/icon.js';
import { IPositronNotebookCell } from '../PositronNotebookCells/IPositronNotebookCell.js';
import { useObservedValue } from '../useObservedValue.js';

// Tag-bar clicks must not bubble to the cell wrapper's selection handler, which
// would re-focus the cell container and blur an open tag input.
function stopCellSelection(e: React.MouseEvent) {
	e.stopPropagation();
}

/**
 * Renders the tag pills for a cell along with inline add / edit affordances.
 *
 * Renders nothing until the cell has at least one tag -- by design, the add
 * affordance only appears once the first tag exists. The first tag is added
 * via the "Add Tag" command (right-click menu / command palette).
 *
 * On code cells this is embedded in the cell footer alongside the execution
 * status; markdown / raw cells (which have no footer) render it standalone at
 * the bottom of the cell.
 */
export function CellTagsBar({ cell, standalone }: { cell: IPositronNotebookCell; standalone?: boolean }) {
	const { notificationService } = usePositronReactServicesContext();
	const tags = useObservedValue(cell.tags);
	const [editingTag, setEditingTag] = React.useState<string | null>(null);
	const [adding, setAdding] = React.useState(false);

	// No tags -> no UI at all (including the add affordance).
	if (tags.length === 0) {
		return null;
	}

	const notifyDuplicate = (tag: string) => {
		notificationService.info(
			localize('positron.notebook.cellTag.duplicate', "Tag '{0}' is already on this cell.", tag)
		);
	};

	const removeTag = (tag: string) => {
		const latestTags = cell.tags.get();
		if (!latestTags.includes(tag)) {
			return;
		}
		cell.setTags(latestTags.filter(t => t !== tag));
	};

	const commitEdit = (originalTag: string, raw: string) => {
		setEditingTag(null);
		const latestTags = cell.tags.get();
		const index = latestTags.indexOf(originalTag);
		if (index < 0) {
			return;
		}
		const value = raw.trim();
		if (!value) {
			removeTag(originalTag);
			return;
		}
		// Renaming onto an existing tag is rejected; tell the user why rather
		// than silently reverting.
		if (latestTags.some((t, i) => i !== index && t === value)) {
			notifyDuplicate(value);
			return;
		}
		const next = [...latestTags];
		next[index] = value;
		cell.setTags(next);
	};

	const commitAdd = (raw: string) => {
		setAdding(false);
		const value = raw.trim();
		// The cell enforces trim / empty / duplicate handling; surface a toast
		// when the tag already exists so the committed input doesn't just vanish.
		if (cell.addTag(value) === 'duplicate') {
			notifyDuplicate(value);
		}
	};

	return (
		<div className={positronClassNames('positron-notebook-cell-tags', { standalone })} data-testid='cell-tags-bar'>
			{tags.map((tag) =>
				editingTag === tag ? (
					// The edit target is tracked by tag value (the cell model
					// de-duplicates tags on read, so values are unique), not by
					// position, so a tag-list change while an input is open can't shift
					// the open input onto a different pill. Keys are the tag value for
					// the same reason. The `edit-` prefix differs from the display key
					// so switching modes remounts TagInput (re-running its focus effect).
					<TagInput
						key={`edit-${tag}`}
						initialValue={tag}
						onCancel={() => setEditingTag(null)}
						onCommit={(value) => commitEdit(tag, value)}
					/>
				) : (
					<span key={tag} className='positron-notebook-cell-tag'>
						<button
							aria-label={localize('positron.notebook.cellTag.edit', "Edit tag {0}", tag)}
							className='positron-notebook-cell-tag-label'
							title={localize('positron.notebook.cellTag.editHint', "Click to edit tag")}
							type='button'
							onClick={(e) => { stopCellSelection(e); setEditingTag(tag); }}
						>
							{tag}
						</button>
						<button
							aria-label={localize('positron.notebook.cellTag.remove', "Remove tag {0}", tag)}
							className='positron-notebook-cell-tag-remove'
							title={localize('positron.notebook.cellTag.remove', "Remove tag {0}", tag)}
							type='button'
							onClick={(e) => { stopCellSelection(e); removeTag(tag); }}
						>
							<Icon className='positron-notebook-cell-tag-icon' icon={Codicon.close} />
						</button>
					</span>
				)
			)}
			{adding ? (
				<TagInput
					initialValue=''
					onCancel={() => setAdding(false)}
					onCommit={commitAdd}
				/>
			) : (
				<button
					aria-label={localize('positron.notebook.cellTag.add', "Add tag")}
					className='positron-notebook-cell-tag-add'
					title={localize('positron.notebook.cellTag.add', "Add tag")}
					type='button'
					onClick={(e) => { stopCellSelection(e); setAdding(true); }}
				>
					<Icon className='positron-notebook-cell-tag-icon' icon={Codicon.add} />
				</button>
			)}
		</div>
	);
}

/**
 * A small inline text input used for both adding a new tag and editing an
 * existing one. Commits on Enter or blur; cancels on Escape.
 */
function TagInput({ initialValue, onCommit, onCancel }: {
	initialValue: string;
	onCommit: (value: string) => void;
	onCancel: () => void;
}) {
	const [value, setValue] = React.useState(initialValue);
	const inputRef = React.useRef<HTMLInputElement>(null);

	React.useEffect(() => {
		inputRef.current?.focus();
		inputRef.current?.select();
	}, []);

	return (
		<input
			ref={inputRef}
			className='positron-notebook-cell-tag-input'
			placeholder={localize('positron.notebook.cellTag.placeholder', "tag")}
			spellCheck={false}
			value={value}
			onBlur={() => onCommit(value)}
			onChange={(e) => setValue(e.target.value)}
			onClick={stopCellSelection}
			// Stop keystrokes from reaching the notebook's command-mode handlers.
			onKeyDown={(e) => {
				if (e.key === 'Enter') {
					e.preventDefault();
					onCommit(value);
				} else if (e.key === 'Escape') {
					e.preventDefault();
					onCancel();
				}
				e.stopPropagation();
			}}
		/>
	);
}
