/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import React from 'react';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';

interface ErrorMessageWithLinksProps {
	message: string;
	openerService: IOpenerService;
	onLinkClick?: () => void;
}

/**
 * Component that renders an error message with support for markdown-style command links.
 * Parses links like [text](command:id?args) and makes them clickable.
 * Also handles newlines properly by converting them to <br /> elements.
 */
export const ErrorMessageWithLinks: React.FC<ErrorMessageWithLinksProps> = ({ message, openerService, onLinkClick }) => {
	// Helper function to convert text with newlines to React elements
	const renderTextWithNewlines = (text: string, startKey: number): (string | JSX.Element)[] => {
		const lines = text.split('\n');
		const elements: (string | JSX.Element)[] = [];

		lines.forEach((line, i) => {
			if (i > 0) {
				elements.push(<br key={`br-${startKey}-${i}`} />);
			}
			if (line) {
				elements.push(line);
			}
		});

		return elements;
	};

	// Parse markdown-style command links: [text](command:id?args)
	const linkRegex = /\[([^\]]+)\]\(command:([^)]+)\)/g;

	const parts: (string | JSX.Element)[] = [];
	let lastIndex = 0;
	let match;
	let key = 0;

	while ((match = linkRegex.exec(message)) !== null) {
		// Add text before the link (with newline handling)
		if (match.index > lastIndex) {
			const textBefore = message.substring(lastIndex, match.index);
			parts.push(...renderTextWithNewlines(textBefore, key));
		}

		const linkText = match[1];
		const commandLink = `command:${match[2]}`;

		// Create clickable link using openerService
		parts.push(
			<a
				key={`link-${key++}`}
				href='#'
				onClick={(e) => {
					e.preventDefault();
					e.stopPropagation();
					openerService.open(commandLink, {
						fromUserGesture: true,
						allowCommands: true
					});
					// Close the modal after opening the command
					onLinkClick?.();
				}}
			>
				{linkText}
			</a>
		);

		lastIndex = match.index + match[0].length;
	}

	// Add remaining text after the last link (with newline handling)
	if (lastIndex < message.length) {
		const textAfter = message.substring(lastIndex);
		parts.push(...renderTextWithNewlines(textAfter, key));
	}

	return <div className='language-model-error error error-msg'>{parts}</div>;
};
