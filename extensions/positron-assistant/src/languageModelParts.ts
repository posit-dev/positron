/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * This module defines a custom language model image part, allowing tools to
 * return images to language models. Ideally this would be implemented directly
 * in the VSCode API.
 *
 * Tools can return a {@link vscode.LanguageModelPromptTsxPart} with `value`
 * set to the result of {@link LanguageModelImage.toJSON}. For example, see
 * the `getPlot` tool implementation. Note that this does not seem to be the
 * intended use of prompt TSX parts, but works for now.
 *
 * Models can check whether a part is an image using {@link isLanguageModelImagePart},
 * and handle the part accordingly.
 */

enum CustomLanguageModelPartType {
	Image = 'image',
}

export interface LanguageModelImagePart {
	readonly value: LanguageModelImage;
}

export class LanguageModelImage {
	readonly mimeType: string;
	readonly base64: string;

	constructor(mimeType: string, base64: string) {
		this.mimeType = mimeType;
		this.base64 = base64;
	}

	toJSON(): any {
		return {
			$positronType: CustomLanguageModelPartType.Image,
			mimeType: this.mimeType,
			base64: this.base64,
		};
	}
}

export function isLanguageModelImagePart(part: unknown): part is LanguageModelImagePart {
	return part instanceof vscode.LanguageModelPromptTsxPart &&
		part.value !== null &&
		typeof part.value === 'object' &&
		'$positronType' in part.value &&
		part.value.$positronType === CustomLanguageModelPartType.Image;
}
