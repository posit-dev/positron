/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	BasePromptElementProps,
	PromptElement,
	TextChunk
} from '@vscode/prompt-tsx';
import { Tag } from '../Tag';

interface MapEditContentProps extends BasePromptElementProps {
	// No specific props needed for this component
}

/**
 * Component that provides instructions for mapping edits to documents.
 */
export class MapEditContent extends PromptElement<MapEditContentProps> {
	render() {
		return (
			<>
			<TextChunk>
				You will be given a document and a block. Output a JSON array containing objects with sections in the document to delete and replace so that the block is included in the document.
			</TextChunk>
			<Tag name="example">
				<Tag name="user">{'{ "document": "a\\nb\\nc\\nd\\ne", "block": "b\\n123\\ne" }'}</Tag>
				<Tag name="response">[{'{ "delete": "b\\nc\\nd\\ne", "replace": "b\\n123\\ne" }'}]</Tag>
			</Tag>
			<TextChunk>
				If it is not clear where the block should go, append it to the end of the document.
			</TextChunk>
			<Tag name="example">
				<Tag name="user">{'{ "document": "a\\nb\\nc\\nd\\ne", "block": "f\\ng" }'}</Tag>
				<Tag name="response">[{'{ "append": "f\\ng" }'}]</Tag>
			</Tag>
			<TextChunk>
				Return ONLY the JSON string, nothing else. Do NOT use a code fence, return the JSON as plain output.
			</TextChunk>
			</>
		);
	}
}
