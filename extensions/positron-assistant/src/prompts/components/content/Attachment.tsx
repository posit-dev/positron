/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	BasePromptElementProps,
	PromptElement
} from '@vscode/prompt-tsx';
import { Tag } from '../Tag';

export interface AttachmentData {
	content: string;
	filePath?: string;
	description?: string;
	language?: string;
	startLine?: number;
	endLine?: number;
	type?: 'file' | 'range' | 'directory' | 'image' | 'commit';
	historyItemId?: string; // For git commits
	historyItemParentId?: string; // For git commits
	src?: string; // For images
}

export interface AttachmentProps extends BasePromptElementProps {
	attachment: AttachmentData;
}

/**
 * Component for rendering individual attachment data.
 */
export class Attachment extends PromptElement<AttachmentProps> {
	render() {
		const { attachment } = this.props;

		if (attachment.type === 'image') {
			return (
				<Tag name="img" attrs={{ src: attachment.src }} />
			);
		}

		const attrs: Record<string, string | number | undefined> = {};
		if (attachment.filePath) attrs.filePath = attachment.filePath;
		if (attachment.description) attrs.description = attachment.description;
		if (attachment.language) attrs.language = attachment.language;
		if (attachment.startLine) attrs.startLine = attachment.startLine;
		if (attachment.endLine) attrs.endLine = attachment.endLine;

		return (
			<Tag name="attachment" attrs={attrs}>
				{attachment.content}
			</Tag>
		);
	}
}
