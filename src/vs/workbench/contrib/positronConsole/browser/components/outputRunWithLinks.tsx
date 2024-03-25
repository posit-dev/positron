/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { URI } from 'vs/base/common/uri';
import { localize } from 'vs/nls';
import { usePositronConsoleContext } from 'vs/workbench/contrib/positronConsole/browser/positronConsoleContext';

// OutputRunWithLinksProps interface.
export interface OutputRunWithLinksProps {
	readonly text: string;
}

/**
 * OutputRunWithLinks component.
 * @param props A OutputRunWithLinksProps that contains the component properties.
 * @returns The rendered component.
 */
export const OutputRunWithLinks = (props: OutputRunWithLinksProps) => {
	// Context hooks.
	const positronConsoleContext = usePositronConsoleContext();

	// Click handler for each hyperlink.
	const clickHandler = async (url: string) => {
		let uri: URI | undefined;
		try {
			uri = URI.parse(url);
		} catch (err) {
			// This might happen since our URL dectector is just regex-based
			// right now.
			positronConsoleContext.notificationService.warn(
				localize('invalidUri', 'The URL "{0}" is invalid: {1}', url, err));
			return;
		}

		// Open the URI as external; this makes it possible for the Positron
		// Viewer or Simple Browser to pick it up.
		positronConsoleContext.openerService.open(uri,
			{
				fromUserGesture: true,
				openExternal: true,
				allowContributedOpeners: true,
			});
	};

	// Look for a hyperlink in the text.
	//
	// Note that this regex ignores characters that typically delimit a
	// hyperlink, such as quotes, parentheses, and braces, even though these
	// characters are technically allowed in a URL.
	const hyperlinkMatch = props.text.match(/\bhttps?:\/\/[^'")}\s]+/);
	if (hyperlinkMatch) {
		// Create an array of text and hyperlinks for each entry in the match array.
		const parts = [];
		let lastIndex = 0;
		for (const match of hyperlinkMatch) {
			// Add the text before the hyperlink.
			parts.push(props.text.substring(lastIndex, props.text.indexOf(match)));
			lastIndex = props.text.indexOf(match) + match.length;

			// Add the hyperlink.
			parts.push(
				<a
					href='#'
					onClick={clickHandler.bind(null, match)}
					className='output-run-hyperlink'
					key={match}
				>
					{match}
				</a>
			);
		}

		// Render the parts
		parts.push(props.text.substring(lastIndex));
		return <React.Fragment>{parts}</React.Fragment>;

	} else {
		// No hyperlink, so just return the text.
		return <React.Fragment>{props.text}</React.Fragment>;
	}
};
