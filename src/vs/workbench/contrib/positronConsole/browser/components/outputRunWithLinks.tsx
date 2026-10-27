/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { URI } from '../../../../../base/common/uri.js';
import { detectHyperlinks } from '../../common/linkDetector.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';

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
	const services = usePositronReactServicesContext();

	// Click handler for each hyperlink.
	const clickHandler = async (url: string) => {
		let uri: URI | undefined;
		try {
			uri = URI.parse(url);
		} catch (err) {
			// This might happen since our URL dectector is just regex-based
			// right now.
			services.notificationService.warn(
				localize('invalidUri', 'The URL "{0}" is invalid: {1}', url, err));
			return;
		}

		// Open the URI as external; this makes it possible for the Positron
		// Viewer or Simple Browser to pick it up.
		services.openerService.open(uri, {
			fromUserGesture: true,
			openExternal: true,
			allowContributedOpeners: true,
		});
	};

	// Look for a hyperlink in the text.
	//
	const hyperlinkMatches = detectHyperlinks(props.text);
	if (hyperlinkMatches.length) {
		// Create an array of text and hyperlinks for each entry in the match array.
		// Use the index of each match rather than searching for its text, since
		// the same URL can appear more than once.
		const parts = [];
		let lastIndex = 0;
		for (const match of hyperlinkMatches) {
			// Add the text before the hyperlink.
			parts.push(props.text.substring(lastIndex, match.index));
			lastIndex = match.index + match.text.length;

			// Add the hyperlink.
			parts.push(
				<a
					key={match.index}
					className='output-run-hyperlink'
					href='#'
					onClick={clickHandler.bind(null, match.text)}
				>
					{match.text}
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
