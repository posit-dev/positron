/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./activityOutputHtml';
import * as React from 'react';
import { ActivityItemOutputHtml } from 'vs/workbench/services/positronConsole/common/classes/activityItemOutputHtml';
import { HtmlNode, parseHtml } from 'vs/base/common/htmlParser';

// ActivityOutputHtml interface.
export interface ActivityOutputHtmlProps {
	activityItemOutputHtml: ActivityItemOutputHtml;
}

const renderHtml = (html: string) => {

	const parsedContent = parseHtml(html);

	const renderNode = (node: HtmlNode): React.ReactElement | undefined => {
		if (node.type === 'text') {
			if (node.content && node.content.trim().length > 0) {
				return React.createElement('span', {}, node.content);
			}
			return undefined;
		} else if (node.type === 'tag' && node.children) {
			const children = node.children.map(renderNode);
			return React.createElement(node.name!, {}, children);
		} else {
			return React.createElement(node.name!, {});
		}
	};

	const renderedNodes = parsedContent.map(renderNode);

	return <div>{renderedNodes}</div>;
};

/**
 * ActivityOutputHtml component.
 * @param props An ActivityErrorMessageProps that contains the component properties.
 * @returns The rendered component.
 */
export const ActivityOutputHtml = (props: ActivityOutputHtmlProps) => {

	// Render the raw HTML in the div
	return (
		<div className='activity-output-html'>
			{renderHtml(props.activityItemOutputHtml.html)}
		</div>
	);
};
