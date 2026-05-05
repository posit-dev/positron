/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React from 'react';

// CSS.
import './JsonOutput.css';

interface JsonOutputProps {
	data: unknown;
}

/**
 * Renders a JSON value with syntax highlighting.
 * Returns an array of React elements representing the highlighted tokens.
 */
function highlightJson(data: unknown): React.ReactNode[] {
	const json = JSON.stringify(data, null, 2);
	if (json === undefined) {
		return [<span key={0} className='json-null'>undefined</span>];
	}

	const nodes: React.ReactNode[] = [];
	let i = 0;

	// Regex matches JSON tokens: strings, numbers, booleans, null, structural chars
	const tokenRegex = /("(?:[^"\\]|\\.)*")\s*:|("(?:[^"\\]|\\.)*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(\btrue\b|\bfalse\b)|(\bnull\b)|([{}[\],])|(\s+)/g;
	let match: RegExpExecArray | null;

	while ((match = tokenRegex.exec(json)) !== null) {
		const [, key, str, num, bool, nul, punct, ws] = match;

		if (key) {
			// Object key (string followed by colon)
			nodes.push(<span key={i++} className='json-key'>{key}</span>);
			nodes.push(<span key={i++} className='json-punct'>: </span>);
		} else if (str) {
			nodes.push(<span key={i++} className='json-string'>{str}</span>);
		} else if (num) {
			nodes.push(<span key={i++} className='json-number'>{num}</span>);
		} else if (bool) {
			nodes.push(<span key={i++} className='json-boolean'>{bool}</span>);
		} else if (nul) {
			nodes.push(<span key={i++} className='json-null'>{nul}</span>);
		} else if (punct) {
			nodes.push(<span key={i++} className='json-punct'>{punct}</span>);
		} else if (ws) {
			nodes.push(<span key={i++}>{ws}</span>);
		}
	}

	return nodes;
}

export const JsonOutput = React.memo(function JsonOutput({ data }: JsonOutputProps) {
	return (
		<pre className='json-output'>
			<code>{highlightJson(data)}</code>
		</pre>
	);
});
