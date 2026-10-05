/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './objectExplorerRow.css';

// React.
import { CSSProperties, MouseEvent, ReactNode } from 'react';

// Other dependencies.
import { localize } from '../../../../nls.js';
import { ObjectNode, SearchRowMatchKind } from '../../../services/positronObjectExplorer/common/objectExplorerBackend.js';
import { PositronActionBarHoverManager } from '../../../../platform/positronActionBar/browser/positronActionBarHoverManager.js';

/**
 * Inline-style shape for a row. Carries the column widths to the stylesheet.
 */
interface ObjectExplorerRowCSSProperties extends CSSProperties {
	'--object-explorer-name-width': string;
	'--object-explorer-type-width': string;
}

/**
 * Builds the inline style that sizes a row's columns.
 * @param nameWidth The width of the Name cell, after the tree's indent and twisty.
 * @param typeWidth The width of the Type cell.
 */
function rowStyle(nameWidth: number, typeWidth: number): ObjectExplorerRowCSSProperties {
	return {
		'--object-explorer-name-width': `${nameWidth}px`,
		'--object-explorer-type-width': `${typeWidth}px`,
	};
}

/**
 * Shows the full text of a cell in a hover when the cell is too narrow to show it.
 */
function showTruncatedHover(hoverManager: PositronActionBarHoverManager, e: MouseEvent<HTMLElement>, text: string) {
	const target = e.currentTarget;
	if (target.scrollWidth > target.clientWidth) {
		hoverManager.showHover(target, text);
	}
}

/**
 * Renders text with the first case-insensitive occurrence of a search query highlighted.
 */
function highlight(text: string, query: string | undefined): ReactNode {
	const index = query ? text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase()) : -1;
	if (!query || index < 0) {
		return text;
	}
	return <>
		{text.substring(0, index)}
		<span className='object-explorer-match' data-testid='object-explorer-match'>{text.substring(index, index + query.length)}</span>
		{text.substring(index + query.length)}
	</>;
}

/**
 * ObjectExplorerRowProps interface.
 */
interface ObjectExplorerRowProps {
	readonly node: ObjectNode;
	readonly nameWidth: number;
	readonly typeWidth: number;
	readonly maxDepthReached: boolean;
	readonly hoverManager: PositronActionBarHoverManager;
	/** The search query, when the row is a search result. */
	readonly query?: string;
	/** Which of the row's fields matched the search query. */
	readonly match?: SearchRowMatchKind;
}

/**
 * ObjectExplorerRow component. The Name, Type, and Value cells of one node.
 */
export const ObjectExplorerRow = ({ node, nameWidth, typeWidth, maxDepthReached, hoverManager, query, match }: ObjectExplorerRowProps) => {
	const nameMatched = match === SearchRowMatchKind.Name || match === SearchRowMatchKind.NameAndValue;
	const valueMatched = match === SearchRowMatchKind.Value || match === SearchRowMatchKind.NameAndValue;

	const value = node.is_cycle ?
		localize('positron.objectExplorer.circularReference', "(circular reference)") :
		node.display_value;

	const onNameMouseOver = (e: MouseEvent<HTMLElement>) => {
		if (maxDepthReached) {
			hoverManager.showHover(e.currentTarget, localize(
				'positron.objectExplorer.maxDepthReached',
				"Maximum depth reached. Increase the objectExplorer.maxDepth setting to go deeper."
			));
		} else {
			showTruncatedHover(hoverManager, e, node.display_name);
		}
	};

	return (
		<div className='object-explorer-row' data-testid='object-explorer-row' style={rowStyle(nameWidth, typeWidth)}>
			<div
				className='object-explorer-cell name'
				data-testid='object-explorer-name'
				role='presentation'
				onMouseLeave={() => hoverManager.hideHover()}
				onMouseOver={onNameMouseOver}
			>
				{highlight(node.display_name, nameMatched ? query : undefined)}
				{maxDepthReached && <span className='codicon codicon-ellipsis max-depth-indicator' />}
			</div>
			<div
				className='object-explorer-cell type'
				data-testid='object-explorer-type'
				role='presentation'
				onMouseLeave={() => hoverManager.hideHover()}
				onMouseOver={e => showTruncatedHover(hoverManager, e, node.display_type)}
			>
				{node.display_type}
			</div>
			<div
				className={`object-explorer-cell value${node.is_cycle ? ' cycle' : ''}`}
				data-testid='object-explorer-value'
				role='presentation'
				onMouseLeave={() => hoverManager.hideHover()}
				onMouseOver={e => showTruncatedHover(hoverManager, e, value)}
			>
				{highlight(value, valueMatched ? query : undefined)}
			</div>
		</div>
	);
};

/**
 * ObjectExplorerMoreRowProps interface.
 */
interface ObjectExplorerMoreRowProps {
	readonly pageSize: number;
	readonly remaining: number;
	readonly loading: boolean;
	readonly nameWidth: number;
	readonly typeWidth: number;
}

/**
 * ObjectExplorerMoreRow component. Stands in for the children of a node that have not been loaded.
 */
export const ObjectExplorerMoreRow = ({ pageSize, remaining, loading, nameWidth, typeWidth }: ObjectExplorerMoreRowProps) => {
	return (
		<div className='object-explorer-row more' data-testid='object-explorer-more-row' style={rowStyle(nameWidth, typeWidth)}>
			<div className='object-explorer-cell name'>
				{loading && <span className='codicon codicon-loading codicon-modifier-spin' />}
				{localize(
					'positron.objectExplorer.showMore',
					"Show {0} more ({1} remaining)",
					Math.min(pageSize, remaining).toLocaleString(),
					remaining.toLocaleString()
				)}
			</div>
		</div>
	);
};
