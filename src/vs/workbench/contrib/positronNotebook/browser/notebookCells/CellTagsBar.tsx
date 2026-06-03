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
import { notifyTagResult } from './cellTagNotifications.js';

// Tag-bar clicks must not bubble to the cell wrapper's selection handler, which
// would re-focus the cell container and blur an open tag input.
function stopCellSelection(e: React.MouseEvent) {
	e.stopPropagation();
}

/**
 * Renders the tag pills for a cell along with inline add / edit affordances.
 *
 * Renders nothing until the cell has at least one tag or a tag-add has been
 * requested. The passive add affordance (a pill revealed on hover) only appears
 * once the first tag exists; the first tag is added through the "Add Tag" command
 * (right-click menu / command palette), which opens the inline input by flipping
 * the cell's `isAddingTag` signal.
 *
 * On code cells this is embedded in the cell footer alongside the execution
 * status; markdown / raw cells (which have no footer) render it standalone at
 * the bottom of the cell.
 */
export function CellTagsBar({ cell, standalone }: { cell: IPositronNotebookCell; standalone?: boolean }) {
	const { notificationService } = usePositronReactServicesContext();
	const tags = useObservedValue(cell.tags);
	const isAddingTag = useObservedValue(cell.isAddingTag);
	const cellTagsHidden = useObservedValue(cell.cellTagsHidden);
	const [editingTag, setEditingTag] = React.useState<string | null>(null);

	// The notebook can hide all cell tags (a transient, per-notebook toggle).
	if (cellTagsHidden) {
		return null;
	}

	// Nothing to show unless the cell has a tag or a tag-add was requested (via
	// the command or the hover add pill). The passive add pill only appears once
	// the first tag exists; tag-add requests open the inline input below.
	if (tags.length === 0 && !isAddingTag) {
		return null;
	}

	const removeTag = (tag: string) => {
		// The cell owns the membership check and the write; only surface a failed
		// write (e.g. detached cell), otherwise removal is silent.
		if (!cell.removeTag(tag)) {
			notifyTagResult(notificationService, 'failed', tag);
		}
	};

	const commitEdit = (originalTag: string, raw: string) => {
		setEditingTag(null);
		// Clearing the input removes the tag; otherwise the cell owns trim /
		// missing / duplicate handling and reports the outcome to surface.
		if (!raw.trim()) {
			removeTag(originalTag);
			return;
		}
		notifyTagResult(notificationService, cell.renameTag(originalTag, raw), raw.trim());
	};

	const commitAdd = (raw: string) => {
		cell.endAddTag();
		// The cell enforces trim / empty / duplicate handling and reports the
		// outcome; surface a toast so a rejected input doesn't vanish silently.
		notifyTagResult(notificationService, cell.addTag(raw), raw.trim());
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
			{isAddingTag ? (
				<TagInput
					initialValue=''
					onCancel={() => cell.endAddTag()}
					onCommit={commitAdd}
				/>
			) : (
				<button
					aria-label={localize('positron.notebook.cellTag.add', "Add tag")}
					className='positron-notebook-cell-tag-add'
					title={localize('positron.notebook.cellTag.add', "Add tag")}
					type='button'
					onClick={(e) => { stopCellSelection(e); cell.beginAddTag(); }}
				>
					<Icon className='positron-notebook-cell-tag-add-icon' icon={Codicon.addSmall} />
					<span className='positron-notebook-cell-tag-add-label'>
						{localize('positron.notebook.cellTag.add', "Add tag")}
					</span>
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
