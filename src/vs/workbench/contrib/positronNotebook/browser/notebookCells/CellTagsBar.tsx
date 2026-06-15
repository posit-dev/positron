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
import { isHTMLInputElement } from '../../../../../base/browser/dom.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { Icon } from '../../../../../platform/positronActionBar/browser/components/icon.js';
import { IPositronNotebookCell } from '../PositronNotebookCells/IPositronNotebookCell.js';
import { useObservedValue } from '../useObservedValue.js';
import { notifyTagResult } from './cellTagNotifications.js';

// Tag-bar pointer events must not bubble to the cell wrapper's selection handler.
// Buttons also call preventDefault on mousedown so the browser does not move focus
// off the cell container (see positron Button / CellActionButton); the input only
// stops propagation so it can still receive focus when clicked.
function stopTagBarPointer(e: React.MouseEvent) {
	e.preventDefault();
	e.stopPropagation();
}

function stopTagBarBubble(e: React.MouseEvent) {
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
 *
 * Keyboard-wise the bar is a toolbar-pattern composite widget: a single tab
 * stop (the first tag, falling back to the add control on a tagless cell),
 * with the arrow keys moving between the controls inside and Escape
 * returning focus to the cell.
 */
export function CellTagsBar({ cell, standalone }: { cell: IPositronNotebookCell; standalone?: boolean }) {
	const { notificationService } = usePositronReactServicesContext();
	const tags = useObservedValue(cell.tags);
	const isAddingTag = useObservedValue(cell.isAddingTag);
	const tagUIVisible = useObservedValue(cell.tagUIVisible);
	const [editingTag, setEditingTag] = React.useState<string | null>(null);
	const barRef = React.useRef<HTMLDivElement>(null);
	// A committed edit or a removed tag unmounts the focused control, which would
	// drop the keyboard focus ring to <body>. removeTag / commitEdit record the
	// tag whose pill to focus next; this effect restores it once the render commits.
	const pendingFocusRef = React.useRef<string | null>(null);

	React.useLayoutEffect(() => {
		const pendingTag = pendingFocusRef.current;
		pendingFocusRef.current = null;
		const bar = barRef.current;
		if (pendingTag === null || !bar) {
			return;
		}
		// Match by tag value (not a `[data-tag="..."]` selector, which breaks on
		// values with quotes or other selector syntax).
		// eslint-disable-next-line no-restricted-syntax -- enumerating the bar's own tag labels to find one by value, not reaching into structure
		const labels = Array.from(bar.querySelectorAll<HTMLButtonElement>('.positron-notebook-cell-tag-label'));
		labels.find(label => label.dataset.tag === pendingTag)?.focus();
	});

	// True when DOM focus is currently inside the bar -- i.e. the user is driving
	// it by keyboard, so a mutation should keep the focus ring in the bar. A
	// mouse interaction leaves focus outside (the buttons preventDefault their
	// mousedown), and a blur-driven commit has already moved focus away.
	const barHasFocus = () => {
		const bar = barRef.current;
		return !!bar && bar.contains(bar.ownerDocument.activeElement);
	};

	// The cell owns the visibility predicate: nothing to show unless the cell has
	// a tag or a tag-add was requested (via the command or the hover add pill),
	// and the notebook can hide all cell tags (a transient, per-notebook toggle).
	if (!tagUIVisible) {
		return null;
	}

	const removeTag = (tag: string) => {
		// The cell owns the membership check and the write; notifyTagResult only
		// surfaces a failed write (e.g. detached cell), removal is otherwise silent.
		const result = cell.removeTag(tag);
		notifyTagResult(notificationService, result, tag);
		if (result !== 'ok') {
			return;
		}
		// The removed control unmounts. For a keyboard removal with tags left, keep
		// the focus ring in the bar by landing on the neighbor that slides into this
		// slot (or the new last tag). Otherwise -- a mouse removal (focus was never
		// in the bar), or removing the last tag (the whole bar unmounts as
		// tagUIVisible turns false) -- pin focus to the cell so selection chrome does
		// not flicker onto the following cell.
		const remaining = tags.filter(t => t !== tag);
		if (barHasFocus() && remaining.length > 0) {
			pendingFocusRef.current = remaining[Math.min(tags.indexOf(tag), remaining.length - 1)];
		} else {
			cell.container?.focus({ preventScroll: true });
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
		const result = cell.renameTag(originalTag, raw);
		notifyTagResult(notificationService, result, raw.trim());
		// Return the focus ring to the pill once the input unmounts -- but only for
		// an Enter commit (focus still in the bar); a blur commit means the user
		// already moved focus elsewhere. A rejected rename keeps the original tag.
		if (barHasFocus()) {
			pendingFocusRef.current = result === 'ok' ? raw.trim() : originalTag;
		}
	};

	const commitAdd = (raw: string) => {
		cell.endAddTag();
		// The cell enforces trim / empty / duplicate handling and reports the
		// outcome; surface a toast so a rejected input doesn't vanish silently.
		notifyTagResult(notificationService, cell.addTag(raw), raw.trim());
	};

	// The bar is a composite widget with a single tab stop (the first tag's
	// label, or the add control when the cell has no tags); everything else is
	// tabIndex -1 and reached with the arrow keys, per the WAI-ARIA toolbar
	// pattern. This keeps a long tag list from adding a tab stop per tag for
	// keyboard users traversing the notebook.
	const handleBarKeyDown = (e: React.KeyboardEvent) => {
		// The inline tag input handles (and stops) its own keys.
		if (isHTMLInputElement(e.target)) {
			return;
		}
		switch (e.key) {
			case 'ArrowRight':
			case 'ArrowLeft':
			case 'Home':
			case 'End': {
				// Move focus within the bar instead of letting the notebook's
				// command-mode keybindings move the cell selection.
				e.preventDefault();
				e.stopPropagation();
				// eslint-disable-next-line no-restricted-syntax -- enumerating the bar's own buttons in DOM order for roving focus, not reaching into structure via a fragile selector
				const buttons = Array.from(barRef.current?.querySelectorAll('button') ?? []);
				if (buttons.length === 0) {
					return;
				}
				const current = buttons.indexOf(e.target as HTMLButtonElement);
				const next =
					e.key === 'Home' ? 0 :
						e.key === 'End' ? buttons.length - 1 :
							// Wrap around at the ends.
							(current + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
				buttons[next].focus();
				break;
			}
			case 'Enter':
			case ' ': {
				// Let the focused button's native activation run, but keep the
				// key from reaching the notebook's command-mode keybindings --
				// Enter would otherwise put the cell into edit mode on top of
				// the tag action.
				e.stopPropagation();
				break;
			}
			case 'Escape': {
				// Hand focus back to the cell so notebook-level navigation resumes.
				e.preventDefault();
				e.stopPropagation();
				cell.container?.focus({ preventScroll: true });
				break;
			}
		}
	};

	return (
		<div
			ref={barRef}
			aria-label={localize('positron.notebook.cellTag.toolbar', "Cell tags")}
			className={positronClassNames('positron-notebook-cell-tags', { standalone })}
			data-testid='cell-tags-bar'
			role='toolbar'
			onKeyDown={handleBarKeyDown}
			onMouseDown={stopTagBarBubble}
		>
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
							// Lets the focus-restoration effect find this pill by value
							// after a neighbor is removed or this tag is renamed.
							data-tag={tag}
							// The first tag is the bar's tab stop (see the
							// roving-tabindex note on handleBarKeyDown).
							tabIndex={tag === tags[0] ? 0 : -1}
							title={localize('positron.notebook.cellTag.editHint', "Click to edit tag")}
							type='button'
							onClick={(e) => { stopTagBarPointer(e); setEditingTag(tag); }}
							onMouseDown={stopTagBarPointer}
						>
							{tag}
						</button>
						<button
							aria-label={localize('positron.notebook.cellTag.remove', "Remove tag {0}", tag)}
							className='positron-notebook-cell-tag-remove'
							tabIndex={-1}
							title={localize('positron.notebook.cellTag.remove', "Remove tag {0}", tag)}
							type='button'
							onClick={(e) => { stopTagBarPointer(e); removeTag(tag); }}
							onMouseDown={stopTagBarPointer}
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
					// Only the bar's tab stop when there are no tags ahead of it
					// (see the roving-tabindex note on handleBarKeyDown).
					tabIndex={tags.length === 0 ? 0 : -1}
					title={localize('positron.notebook.cellTag.add', "Add tag")}
					type='button'
					onClick={(e) => { stopTagBarPointer(e); cell.beginAddTag(); }}
					onMouseDown={stopTagBarPointer}
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
			onClick={stopTagBarBubble}
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
			onMouseDown={stopTagBarBubble}
		/>
	);
}
