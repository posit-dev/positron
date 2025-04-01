/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './embeddedLink.css';

import React from 'react';

/**
 * A component that displays a string and converts any markdown links in the string to a href links.
 *
 * @param props the string to display containing markdown links to convert to a link
 */
export const EmbeddedLink = (props: React.PropsWithChildren) => {
	// capture markdown links in the format [text](url)
	const regex = /\[([^\]]+)\]\(([^)]+)\)/g;
	const text = props.children as string;

	// Splits the text into tuples of [text, linkText, linkUrl]
	// e.g. "This is a [link](https://example.com)" becomes ["This is a ", "link", "https://example.com"]
	// If a markdown link has no plain text before it, it will be split into ["", "link", "https://example.com"]
	const parts = text.split(regex);

	return (
		<span className='embedded-link'>
			{parts.map((part, index) => {
				// This is the first part of the markdown link
				if (index % 3 === 1) {
					// The second part of the markdown link
					const link = parts[index + 1];
					return (
						<a key={index} href={link} rel='noreferrer' target='_blank'>
							{part}
						</a>
					);
				} else if (index % 3 === 0) {
					// This is plain text
					return part;
				}
				return null;
			})}
		</span>
	);
}
