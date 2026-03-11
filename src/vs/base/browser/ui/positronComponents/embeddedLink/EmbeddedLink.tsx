/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { usePositronReactServicesContext } from '../../../positronReactRendererContext.js';
import './embeddedLink.css';

import React from 'react';

interface EmbeddedLinkProps {
	/** Called after any link (regular or command) is clicked. */
	onLinkClick?: (e: React.MouseEvent<HTMLAnchorElement, MouseEvent>) => void;
}

/**
 * A component that displays a string and converts any markdown links in the string to a href links.
 * It also handles paragraphs by splitting the input text by newlines and wrapping each paragraph
 * in appropriate HTML elements.
 *
 * @param props the string to display containing markdown links to convert to a link
 */
export const EmbeddedLink = (props: React.PropsWithChildren<EmbeddedLinkProps>) => {
	const { onLinkClick } = props;

	// Pull in services
	const { openerService } = usePositronReactServicesContext();

	// capture markdown links in the format [text](url)
	const regex = /\[([^\]]*)\]\(([^)]+)\)/g;
	const text = props.children as string;

	// Split text into paragraphs first
	const paragraphs = text.split(/\n\n+/);

	const handleLinkClick = (e: React.MouseEvent<HTMLAnchorElement, MouseEvent>) => {
		// Call any provided onLinkClick handler
		onLinkClick?.(e);

		if (e.isDefaultPrevented()) {
			return;
		}

		const link = e.currentTarget.href;
		// Handle command links here
		if (link.startsWith('command:')) {
			// handle a command
			e.preventDefault();
			openerService.open(link, { allowCommands: true });
			return;
		}

		// For regular links, let the default behavior happen (open in new tab)
		return;
	};

	// Splits the text into tuples of [text, linkText, linkUrl]
	// e.g. "This is a [link](https://example.com)" becomes ["This is a ", "link", "https://example.com"]
	// If a markdown link has no plain text before it, it will be split into ["", "link", "https://example.com"]
	const processMarkdownLinks = (paragraph: string) => {
		const parts = paragraph.split(regex);
		return parts.map((part, index) => {
			if (index % 3 === 1) {
				// The second part of the markdown link
				const link = parts[index + 1];
				const linkText = part || link; // Use URL as text if no text provided
				return (
					<a key={index} href={link} rel='noreferrer' target='_blank' onClick={handleLinkClick}>
						{linkText}
					</a>
				);
			} else if (index % 3 === 0) {
				// This is plain text
				return part;
			}
			return null;
		});
	};

	return (
		<span className='embedded-link'>
			{paragraphs.map((paragraph, index) => (
				<p key={index}>
					{processMarkdownLinks(paragraph)}
				</p>
			))}
		</span>
	);
};
