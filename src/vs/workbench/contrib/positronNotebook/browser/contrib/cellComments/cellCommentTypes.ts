/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * A single comment on a notebook cell.
 */
export interface ICellComment {
	/** Unique identifier for the comment */
	id: string;
	/** Display name of the comment author */
	author: string;
	/** The comment text */
	text: string;
	/** ISO 8601 timestamp of when the comment was created */
	timestamp: string;
}

/**
 * Read comments from cell metadata.
 *
 * Cell metadata in VS Code's model has a nested structure:
 *   cell.metadata.metadata -> ipynb file cell metadata
 *
 * So comments live at: cell.metadata.metadata.positron.comments
 */
export function getCellComments(metadata: Record<string, unknown> | undefined): ICellComment[] {
	if (!metadata) {
		return [];
	}
	// Access inner metadata (this is what gets serialized to the ipynb file)
	const innerMetadata = metadata.metadata as Record<string, unknown> | undefined;
	const positron = innerMetadata?.positron as Record<string, unknown> | undefined;
	const comments = positron?.comments;
	if (!Array.isArray(comments)) {
		return [];
	}

	// Validate each comment
	return comments.filter((c): c is ICellComment =>
		typeof c === 'object' && c !== null &&
		typeof c.id === 'string' &&
		typeof c.author === 'string' &&
		typeof c.text === 'string' &&
		typeof c.timestamp === 'string'
	);
}

/**
 * Build new cell metadata with updated comments.
 * Returns a new metadata object (does not mutate the input).
 *
 * Cell metadata in VS Code's model has a nested structure:
 *   cell.metadata.metadata -> ipynb file cell metadata
 *
 * So comments are written to: cell.metadata.metadata.positron.comments
 */
export function setCellComments(
	metadata: Record<string, unknown>,
	comments: ICellComment[]
): Record<string, unknown> {
	// Access inner metadata (this is what gets serialized to the ipynb file)
	const innerMetadata = (metadata.metadata as Record<string, unknown>) ?? {};
	const currentPositron = (innerMetadata.positron as Record<string, unknown>) ?? {};

	// Update positron.comments
	const newPositron: Record<string, unknown> = { ...currentPositron };
	if (comments.length > 0) {
		newPositron.comments = comments;
	} else {
		delete newPositron.comments;
	}

	// Rebuild inner metadata, removing empty positron container
	const newInnerMetadata: Record<string, unknown> = { ...innerMetadata };
	if (Object.keys(newPositron).length > 0) {
		newInnerMetadata.positron = newPositron;
	} else {
		delete newInnerMetadata.positron;
	}

	// Rebuild root metadata with updated inner metadata
	const newMetadata: Record<string, unknown> = { ...metadata };
	newMetadata.metadata = newInnerMetadata;

	return newMetadata;
}

/**
 * Generate a simple unique ID for a comment.
 */
export function generateCommentId(): string {
	return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}
