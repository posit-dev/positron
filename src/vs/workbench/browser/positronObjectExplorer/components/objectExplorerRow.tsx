/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './objectExplorerRow.css';

// React.
import { CSSProperties, MouseEvent, ReactNode, useLayoutEffect, useRef, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../nls.js';
import { FormattedValue, ObjectNode, ObjectNodeKind, SearchRowMatchKind } from '../../../services/positronObjectExplorer/common/objectExplorerBackend.js';
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
	/** Whether the row shows its full value, up to a limit. */
	readonly expanded: boolean;
	/** The value an expanded row shows, once it has been fetched. */
	readonly expandedValue?: FormattedValue;
	/** Called with the height of an expanded row's content after it renders. */
	readonly onDidMeasure: (height: number) => void;
	/** Expands or collapses the node. */
	readonly onDoubleClick: () => void;
	/** Opens the node's full value in an editor. */
	readonly onOpenValue: () => void;
	/** Opens the node in a Data Explorer, for tables. */
	readonly onViewTable?: () => void;
}

/**
 * ObjectExplorerRow component. The Name, Type, and Value cells of one node.
 */
export const ObjectExplorerRow = ({ node, nameWidth, typeWidth, maxDepthReached, hoverManager, query, match, expanded, expandedValue, onDidMeasure, onDoubleClick, onOpenValue, onViewTable }: ObjectExplorerRowProps) => {
	const valueCellRef = useRef<HTMLDivElement>(null);
	const valueTextRef = useRef<HTMLDivElement>(null);
	const [clamped, setClamped] = useState(false);

	useLayoutEffect(() => {
		if (expanded && valueCellRef.current && valueTextRef.current) {
			setClamped(valueTextRef.current.scrollHeight > valueTextRef.current.clientHeight);
			onDidMeasure(valueCellRef.current.offsetHeight);
		}
	}, [expanded, onDidMeasure]);

	const openValueLabel = localize('positron.objectExplorer.openValueInEditor', "Open Value in Editor");
	const viewTableLabel = localize('positron.objectExplorer.viewTable', "View Data Table");
	const nameMatched = match === SearchRowMatchKind.Name || match === SearchRowMatchKind.NameAndValue;
	const valueMatched = match === SearchRowMatchKind.Value || match === SearchRowMatchKind.NameAndValue;

	const value = node.is_cycle ?
		localize('positron.objectExplorer.circularReference', "(circular reference)") :
		node.display_value;
	// An expanded string keeps the quotes its display value has.
	const quote = node.kind === ObjectNodeKind.String ? /^["']/.exec(node.display_value)?.[0] ?? '' : '';
	const shownValue = !expandedValue ? value :
		`${quote}${expandedValue.content}${expandedValue.is_truncated ? '\u2026' : quote}`;
	const truncated = expandedValue ? expandedValue.is_truncated : node.is_truncated;

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
		<div className={`object-explorer-row${expanded ? ' expanded' : ''}${nameMatched || valueMatched ? ' matched' : ''}`} data-testid='object-explorer-row' role='presentation' style={rowStyle(nameWidth, typeWidth)} onDoubleClick={onDoubleClick}>
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
				ref={valueCellRef}
				className={`object-explorer-cell value${node.is_cycle ? ' cycle' : ''}${onViewTable ? ' table' : ''}`}
				data-testid='object-explorer-value'
				role='presentation'
				onMouseLeave={() => hoverManager.hideHover()}
			>
				<div
					ref={valueTextRef}
					className='value-text'
					data-testid='object-explorer-value-text'
					role='presentation'
					onMouseOver={e => !expanded && showTruncatedHover(hoverManager, e, value)}
				>
					{highlight(shownValue, valueMatched ? query : undefined)}
				</div>
				{expanded && (truncated || clamped) &&
					<button
						aria-label={openValueLabel}
						className='open-value codicon codicon-file-text'
						data-testid='object-explorer-open-value'
						type='button'
						onClick={e => {
							e.stopPropagation();
							onOpenValue();
						}}
						onDoubleClick={e => e.stopPropagation()}
						onMouseDown={e => e.stopPropagation()}
						onMouseOver={e => hoverManager.showHover(e.currentTarget, openValueLabel)}
					/>
				}
				{onViewTable &&
					<button
						aria-label={viewTableLabel}
						className='view-table codicon codicon-table'
						data-testid='object-explorer-view-table'
						type='button'
						onClick={e => {
							e.stopPropagation();
							onViewTable();
						}}
						onDoubleClick={e => e.stopPropagation()}
						onMouseDown={e => e.stopPropagation()}
						onMouseOver={e => hoverManager.showHover(e.currentTarget, viewTableLabel)}
					/>
				}
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

/**
 * ObjectExplorerSearchFooterProps interface.
 */
interface ObjectExplorerSearchFooterProps {
	readonly query: string;
	readonly totalMatches: number;
	readonly truncated: boolean;
	readonly onClearSearch: () => void;
}

/**
 * ObjectExplorerSearchFooter component. Follows the results of a search with their count.
 */
export const ObjectExplorerSearchFooter = ({ query, totalMatches, truncated, onClearSearch }: ObjectExplorerSearchFooterProps) => {
	const matches = totalMatches === 1 ?
		localize('positron.objectExplorer.searchFooterOne', "1 match for '{0}'", query) :
		localize('positron.objectExplorer.searchFooter', "{0} matches for '{1}'", totalMatches.toLocaleString(), query);
	return (
		<div className='object-explorer-search-footer' data-testid='object-explorer-search-footer'>
			{matches}{' '}
			{truncated && <>{localize('positron.objectExplorer.searchFooterTruncated', "(search stopped early)")}{' '}</>}
			<a
				href='#'
				onClick={e => {
					e.preventDefault();
					onClearSearch();
				}}
			>
				{localize('positron.objectExplorer.clearSearch', "(clear search)")}
			</a>
		</div>
	);
};
