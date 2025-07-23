/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Ported from microsoft/vscode-copilot-chat

import { PromptElement, PromptElementProps, TextChunk, useKeepWith } from '@vscode/prompt-tsx';

export type TagProps = PromptElementProps<{
	name: string;
	attrs?: Record<string, string | undefined | boolean | number>;
}>;

/**
 * Represents a custom tag in the prompt.
 */
export class Tag extends PromptElement<TagProps> {

	private static readonly _regex = /^[a-zA-Z_][\w\.\-]*$/;

	render() {

		const { name, children, attrs = {} } = this.props;

		if (!Tag._regex.test(name)) {
			throw new Error(`Invalid tag name: ${this.props.name}`);
		}

		let attrStr = '';
		for (const [key, value] of Object.entries(attrs)) {
			if (value !== undefined) {
				attrStr += ` ${key}=${JSON.stringify(value)}`;
			}
		}

		if (children?.length === 0) {
			if (!attrStr) {
				return null;
			}

			return <TextChunk>{`<${name}${attrStr} />`}</TextChunk>;
		}

		const KeepWith = useKeepWith();

		return (
			<>
				<KeepWith>{`<${name}${attrStr}>\n`}</KeepWith>
				<TagInner priority={1} flexGrow={1}>{children}<br /></TagInner>
				<KeepWith>{`</${name}>`}</KeepWith>
				<br />
			</>
		);
	}
}

class TagInner extends PromptElement {
	render() {
		return <>{this.props.children}</>;
	}
}
