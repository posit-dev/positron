/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './CellCommentsModal.css';

// React.
import React, { useCallback, useRef, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../../nls.js';
import { PositronModalReactRenderer } from '../../../../../../base/browser/positronModalReactRenderer.js';
import { OKCancelModalDialog } from '../../../../../browser/positronComponents/positronModalDialog/positronOKCancelModalDialog.js';
import { ICellComment, generateCommentId } from './cellCommentTypes.js';

// Localized strings.
const dialogTitle = localize('cellComments.title', 'Cell Comments');
const saveButtonLabel = localize('cellComments.save', 'Save');
const cancelButtonLabel = localize('cellComments.cancel', 'Cancel');
const noCommentsText = localize('cellComments.noComments', 'No comments yet. Add one below.');
const authorLabel = localize('cellComments.author', 'Your name');
const commentLabel = localize('cellComments.comment', 'Comment');
const deleteLabel = localize('cellComments.delete', 'Delete');
const addLabel = localize('cellComments.add', 'Add');

/**
 * Format a timestamp for display.
 */
function formatTimestamp(iso: string): string {
	try {
		const date = new Date(iso);
		return date.toLocaleString();
	} catch {
		return iso;
	}
}

/**
 * CellCommentsModalProps interface.
 */
interface CellCommentsModalProps {
	renderer: PositronModalReactRenderer;
	comments: ICellComment[];
	defaultAuthor: string;
	onSave: (comments: ICellComment[]) => void;
}

/**
 * CellCommentsModal component.
 * Displays existing comments on a cell and allows adding new ones.
 */
export const CellCommentsModal: React.FC<CellCommentsModalProps> = ({
	renderer,
	comments: initialComments,
	defaultAuthor,
	onSave,
}) => {
	const [comments, setComments] = useState<ICellComment[]>(initialComments);
	const [author, setAuthor] = useState(defaultAuthor);
	const [text, setText] = useState('');
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const threadRef = useRef<HTMLDivElement>(null);

	const addComment = useCallback(() => {
		const trimmedText = text.trim();
		if (!trimmedText) {
			return false;
		}

		const newComment: ICellComment = {
			id: generateCommentId(),
			author: author.trim() || 'Anonymous',
			text: trimmedText,
			timestamp: new Date().toISOString(),
		};

		setComments(prev => [...prev, newComment]);
		setText('');

		// Scroll thread to bottom after adding
		setTimeout(() => {
			threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' });
		}, 0);

		return true;
	}, [author, text]);

	const handleAddClick = useCallback(() => {
		addComment();
		textareaRef.current?.focus();
	}, [addComment]);

	const handleDeleteComment = useCallback((id: string) => {
		setComments(prev => prev.filter(c => c.id !== id));
	}, []);

	const handleAccept = useCallback(() => {
		// If there is pending text, add it as a comment before saving
		let finalComments = comments;
		const trimmedText = text.trim();
		if (trimmedText) {
			const newComment: ICellComment = {
				id: generateCommentId(),
				author: author.trim() || 'Anonymous',
				text: trimmedText,
				timestamp: new Date().toISOString(),
			};
			finalComments = [...comments, newComment];
		}
		onSave(finalComments);
		renderer.dispose();
	}, [comments, text, author, onSave, renderer]);

	const handleCancel = useCallback(() => {
		renderer.dispose();
	}, [renderer]);

	const handleTextareaKeyDown = useCallback((e: React.KeyboardEvent) => {
		if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			handleAddClick();
		}
	}, [handleAddClick]);

	return (
		<OKCancelModalDialog
			cancelButtonTitle={cancelButtonLabel}
			height={480}
			okButtonTitle={saveButtonLabel}
			renderer={renderer}
			title={dialogTitle}
			width={460}
			onAccept={handleAccept}
			onCancel={handleCancel}
		>
			<div className='cell-comments-content'>
				{/* Existing comments thread */}
				<div ref={threadRef} className='cell-comments-thread'>
					{comments.length === 0 ? (
						<div className='cell-comments-empty'>{noCommentsText}</div>
					) : (
						comments.map(comment => (
							<div key={comment.id} className='cell-comment-item'>
								<div className='cell-comment-header'>
									<span className='cell-comment-author'>{comment.author}</span>
									<div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
										<span className='cell-comment-time'>
											{formatTimestamp(comment.timestamp)}
										</span>
										<button
											aria-label={deleteLabel}
											className='cell-comment-delete-button'
											title={deleteLabel}
											onClick={() => handleDeleteComment(comment.id)}
										>
											x
										</button>
									</div>
								</div>
								<div className='cell-comment-text'>{comment.text}</div>
							</div>
						))
					)}
				</div>

				{/* New comment form */}
				<div className='cell-comments-new-comment'>
					<label>{authorLabel}</label>
					<input
						placeholder='Your name'
						type='text'
						value={author}
						onChange={e => setAuthor(e.target.value)}
					/>
					<label>{commentLabel}</label>
					<textarea
						ref={textareaRef}
						placeholder='Write a comment...'
						value={text}
						onChange={e => setText(e.target.value)}
						onKeyDown={handleTextareaKeyDown}
					/>
					<button
						className='cell-comments-add-button'
						disabled={!text.trim()}
						onClick={handleAddClick}
					>
						{addLabel}
					</button>
				</div>
			</div>
		</OKCancelModalDialog>
	);
};
