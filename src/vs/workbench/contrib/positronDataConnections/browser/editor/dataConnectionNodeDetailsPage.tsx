/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './dataConnectionNodeDetailsPage.css';

// React.
import { CSSProperties, useEffect, useLayoutEffect, useRef, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';
import { PositronTabs } from '../../../../../base/browser/ui/positronComponents/tabs/positronTabs.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { FontInfo } from '../../../../../editor/common/config/fontInfo.js';
import { FontConfigurationManager } from '../../../../browser/fontConfigurationManager.js';
import { POSITRON_DATA_CONNECTIONS_VIEW_ID } from '../positronDataConnectionsConfiguration.js';
import { nodeReloadKey } from '../classes/dataConnectionNodeKey.js';
import { IHoverManager } from '../../../../../platform/hover/browser/hoverManager.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';
import { PositronActionBarHoverManager } from '../../../../../platform/positronActionBar/browser/positronActionBarHoverManager.js';
import { kindIcon } from '../components/dataConnectionNodeRow.js';
import { DataConnectionNodeDetailsEditorInput } from './dataConnectionNodeDetailsEditorInput.js';
import { IDataConnectionNodeDetailsItemDTO, IDataConnectionNodeDetailsSectionDTO } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionDTOs.js';

/**
 * The deepest heading level a nested group is shown at. The node's name is the page's h1 and
 * top-level groups are h2, so this leaves three levels of nesting before headings stop shrinking.
 */
const MAX_HEADING_LEVEL = 4;

/**
 * The item kinds that stand for a value of some data type -- a column, or a semantic view's
 * dimension or fact -- and so are better told apart by that type than by their kind.
 */
const TYPED_VALUE_KINDS = new Set(['field', 'dimension', 'time-dimension', 'fact']);

/**
 * Maps a SQL data type to a codicon, for the typed-value kinds: text, number, date and time, and
 * boolean each read at a glance, the way Snowsight marks a semantic view's members. Anything else
 * falls back to the item's kind icon.
 */
function dataTypeIcon(dataType: string): string | undefined {
	const type = dataType.toUpperCase();
	if (/^(VARCHAR|CHAR|CHARACTER|STRING|TEXT|NVARCHAR|NCHAR)\b/.test(type)) {
		return 'symbol-string';
	}
	if (/^(NUMBER|NUMERIC|DECIMAL|INT|INTEGER|BIGINT|SMALLINT|TINYINT|BYTEINT|FLOAT|FLOAT4|FLOAT8|DOUBLE|REAL)\b/.test(type)) {
		return 'symbol-numeric';
	}
	if (/^(DATE|TIME|TIMESTAMP|DATETIME)/.test(type)) {
		return 'calendar';
	}
	if (/^BOOLEAN\b/.test(type)) {
		return 'symbol-boolean';
	}
	return undefined;
}

/**
 * Picks an item's icon: its data type's, for a typed value whose type is recognized, and its
 * kind's otherwise.
 */
function itemIcon(item: IDataConnectionNodeDetailsItemDTO): string | undefined {
	if (!item.kind) {
		return undefined;
	}
	const typeIcon = item.dataType && TYPED_VALUE_KINDS.has(item.kind) ? dataTypeIcon(item.dataType) : undefined;
	return typeIcon ?? kindIcon({ kind: item.kind });
}

/**
 * DataConnectionNodeDetailsItem component. One entry in an items section, the way Snowsight lays
 * out a semantic view's members: an icon and name, then the entry's description, then its code and
 * data type together beneath.
 */
const DataConnectionNodeDetailsItem = ({ item }: { item: IDataConnectionNodeDetailsItemDTO }) => {
	const icon = itemIcon(item);
	return (
		<li className='data-connection-node-details-item'>
			<div className='data-connection-node-details-item-heading'>
				{icon && <div className={`codicon codicon-${icon} data-connection-node-details-item-icon`} />}
				<span className='data-connection-node-details-item-name'>{item.name}</span>
			</div>
			{item.description && <div className='data-connection-node-details-item-description'>{item.description}</div>}
			{(item.code || item.dataType) && (
				<div className='data-connection-node-details-item-definition'>
					{item.code && <code className='data-connection-node-details-item-code'>{item.code}</code>}
					{item.code && item.dataType && <span aria-hidden='true' className='data-connection-node-details-item-separator'>{'\u00b7'}</span>}
					{item.dataType && <span className='data-connection-node-details-item-type'>{item.dataType}</span>}
				</div>
			)}
		</li>
	);
};

/**
 * What the page's sections can do beyond showing themselves: reveal the tree node a group stands for,
 * with the tooltip its button shows.
 */
interface IDataConnectionNodeDetailsActions {
	// Shows the tree node a group stands for, given its treePath.
	readonly revealInTree: (treePath: readonly { kind: string; name: string }[]) => void;

	// Shows the reveal buttons' tooltips; undefined until the page has mounted.
	readonly hoverManager: IHoverManager | undefined;
}

/**
 * DataConnectionNodeDetailsGroup component. A heading, with an optional count, over sections of its
 * own. A collapsible group's heading is a button that shows and hides them; groups start expanded.
 * A group that stands for a tree node gets a button after its heading that shows the node in the
 * Data Connections pane, appearing when the heading is pointed at or the button has keyboard focus.
 * The button sits beside the heading element rather than in it, so the heading's accessible name
 * stays its title and count.
 */
const DataConnectionNodeDetailsGroup = ({ section, level, actions }: {
	section: Extract<IDataConnectionNodeDetailsSectionDTO, { kind: 'group' }>;
	level: number;
	actions: IDataConnectionNodeDetailsActions;
}) => {
	const [expanded, setExpanded] = useState(true);
	const Heading = `h${Math.min(level, MAX_HEADING_LEVEL)}` as 'h2' | 'h3' | 'h4';
	const headingContent = <>
		<span>{section.title}</span>
		{section.count !== undefined && <span className='data-connection-node-details-count'>{section.count}</span>}
	</>;

	return (
		<section className={positronClassNames('data-connection-node-details-group', `level-${Math.min(level, MAX_HEADING_LEVEL)}`, { collapsible: section.collapsible })}>
			<div className='data-connection-node-details-group-title'>
				<Heading className='data-connection-node-details-group-heading'>
					{section.collapsible ? (
						<button
							aria-expanded={expanded}
							className='data-connection-node-details-group-toggle'
							onClick={() => setExpanded(!expanded)}
						>
							<span className={`codicon codicon-chevron-${expanded ? 'down' : 'right'}`} />
							{headingContent}
						</button>
					) : headingContent}
				</Heading>
				{section.treePath && (
					<Button
						ariaLabel={localize('positron.dataConnections.nodeDetails.showInTree', "Show {0} in Data Connections", section.title)}
						className='data-connection-node-details-reveal'
						hoverManager={actions.hoverManager}
						tooltip={localize('positron.dataConnections.nodeDetails.showInTreeTooltip', "Show in Data Connections")}
						onPressed={() => actions.revealInTree(section.treePath!)}
					>
						<span aria-hidden='true' className='codicon codicon-list-tree' />
					</Button>
				)}
			</div>
			{expanded && (
				<div className='data-connection-node-details-group-content'>
					{section.sections.map((child, index) => <DataConnectionNodeDetailsSection key={index} actions={actions} level={level + 1} section={child} />)}
				</div>
			)}
		</section>
	);
};

/**
 * DataConnectionNodeDetailsSection component. Renders one section of a node's details according to
 * its kind. The driver decides what goes in each section; this only decides how each kind looks, so
 * every driver's details read the same way.
 */
const DataConnectionNodeDetailsSection = ({ section, level, actions }: {
	section: IDataConnectionNodeDetailsSectionDTO;
	level: number;
	actions: IDataConnectionNodeDetailsActions;
}) => {
	if (section.kind === 'group') {
		return <DataConnectionNodeDetailsGroup actions={actions} level={level} section={section} />;
	}

	const content = (() => {
		switch (section.kind) {
			case 'properties':
				return (
					<dl className='data-connection-node-details-properties'>
						{section.properties.map((property, index) => (
							<div key={index} className='data-connection-node-details-property'>
								<dt>{property.name}</dt>
								<dd>{property.value}</dd>
							</div>
						))}
					</dl>
				);

			case 'code':
				return (
					<pre className='data-connection-node-details-code'>
						<code>{section.code}</code>
					</pre>
				);

			case 'table':
				return (
					<table className='data-connection-node-details-table'>
						<thead>
							<tr>
								{section.columns.map((column, index) => <th key={index}>{column}</th>)}
							</tr>
						</thead>
						<tbody>
							{section.rows.map((row, rowIndex) => (
								<tr key={rowIndex}>
									{row.map((value, columnIndex) => <td key={columnIndex}>{value}</td>)}
								</tr>
							))}
						</tbody>
					</table>
				);

			case 'items':
				return section.items.length === 0
					? section.emptyText && <div className='data-connection-node-details-empty'>{section.emptyText}</div>
					: (
						<ul className='data-connection-node-details-items'>
							{section.items.map((item, index) => <DataConnectionNodeDetailsItem key={index} item={item} />)}
						</ul>
					);
		}
	})();

	const Heading = `h${Math.min(level, MAX_HEADING_LEVEL)}` as 'h2' | 'h3' | 'h4';
	return (
		<section className='data-connection-node-details-section'>
			{section.title && <Heading className='data-connection-node-details-section-title'>{section.title}</Heading>}
			{content}
		</section>
	);
};

/**
 * Renders a list of sections, or a note that there are none.
 */
const DataConnectionNodeDetailsSections = ({ sections, actions }: {
	sections: IDataConnectionNodeDetailsSectionDTO[];
	actions: IDataConnectionNodeDetailsActions;
}) => (
	sections.length === 0 ? (
		<div className='data-connection-node-details-empty'>
			{localize('positron.dataConnections.nodeDetails.empty', "No details are available for this item.")}
		</div>
	) : (
		<div className='data-connection-node-details-sections'>
			{sections.map((section, index) => <DataConnectionNodeDetailsSection key={index} actions={actions} level={2} section={section} />)}
		</div>
	)
);

/**
 * The page's style: the user's editor font, carried as custom properties for the code blocks and
 * code chips to pick up (see the page's CSS). The rest of the page stays in the workbench font.
 */
interface CodeFontCSSProperties extends CSSProperties {
	'--_data-connection-node-details-code-font-family'?: string;
	'--_data-connection-node-details-code-font-size'?: string;
	'--_data-connection-node-details-code-font-weight'?: string;
	'--_data-connection-node-details-code-font-feature-settings'?: string;
	'--_data-connection-node-details-code-font-variation-settings'?: string;
	'--_data-connection-node-details-code-letter-spacing'?: string;
	'--_data-connection-node-details-code-line-height'?: string;
}

/**
 * Builds the page's code-font custom properties from the editor's font info.
 */
function codeFontStyle(fontInfo: FontInfo): CodeFontCSSProperties {
	return {
		'--_data-connection-node-details-code-font-family': fontInfo.getMassagedFontFamily(),
		'--_data-connection-node-details-code-font-size': `${fontInfo.fontSize}px`,
		'--_data-connection-node-details-code-font-weight': fontInfo.fontWeight,
		'--_data-connection-node-details-code-font-feature-settings': fontInfo.fontFeatureSettings,
		'--_data-connection-node-details-code-font-variation-settings': fontInfo.fontVariationSettings,
		'--_data-connection-node-details-code-letter-spacing': `${fontInfo.letterSpacing}px`,
		'--_data-connection-node-details-code-line-height': `${fontInfo.lineHeight}px`,
	};
}

/**
 * DataConnectionNodeDetailsPageProps interface.
 */
interface DataConnectionNodeDetailsPageProps {
	readonly input: DataConnectionNodeDetailsEditorInput;
}

/**
 * DataConnectionNodeDetailsPage component. The body of the details editor: the node's icon, name,
 * and description, then its details -- as a tab strip over the driver's tabs when it supplies
 * them, and as a single page of sections otherwise. Follows the input's details, so clicking the
 * node again in the tree updates the open tab in place (keeping the selected tab).
 */
export const DataConnectionNodeDetailsPage = ({ input }: DataConnectionNodeDetailsPageProps) => {
	const { configurationService, hoverService, positronDataConnectionsService, viewsService } = usePositronReactServicesContext();
	const [details, setDetails] = useState(() => input.details);

	// Shows a node in the Data Connections pane, given its path below the connection. The pane is
	// opened without focus; the tree then takes it or not, as the request says.
	const reveal = async (nodePath: readonly string[], options: { openDetails?: boolean; preserveFocus?: boolean }) => {
		await viewsService.openView(POSITRON_DATA_CONNECTIONS_VIEW_ID, false);
		positronDataConnectionsService.revealConnection(input.target.profileId, { nodePath, ...options });
	};

	// A breadcrumb shows its node -- the connection itself for the first, which reconnects it if need
	// be -- and opens that node's details, when it has any, in place of these. Focus stays here, on
	// every breadcrumb alike: the user is reading, and a breadcrumb is a way to read somewhere else.
	const revealBreadcrumb = (index: number) => reveal(
		input.target.nodePath.slice(0, input.target.breadcrumbNodePathLengths[index]),
		{ openDetails: index > 0, preserveFocus: true }
	);

	// A group's reveal button goes to the tree node it stands for, somewhere below this node, and
	// takes the user there: it opens no details, and the tree takes focus.
	const [hoverManager, setHoverManager] = useState<IHoverManager | undefined>(undefined);
	useEffect(() => {
		const disposableStore = new DisposableStore();
		setHoverManager(disposableStore.add(new PositronActionBarHoverManager(true, configurationService, hoverService)));
		return () => disposableStore.dispose();
	}, [configurationService, hoverService]);
	const actions: IDataConnectionNodeDetailsActions = {
		hoverManager,
		revealInTree: treePath => reveal(
			[...input.target.nodePath, ...treePath.map(node => nodeReloadKey(node.kind, node.name))],
			{}
		),
	};

	// Code is shown in the font the user picked for the editor, as the Data Explorer and the Console
	// show theirs. It's read into custom properties on the page, rather than applied to each code
	// element, so one listener serves every code block and chip; and read again whenever an editor
	// font setting changes. (--vscode-editor-font-family is only defined inside webviews, so the CSS
	// can't use it here.) Measured once the page is attached, in a layout effect, so it's measured in
	// the page's own window -- which may be an auxiliary one -- and before the first paint.
	const pageRef = useRef<HTMLDivElement>(null);
	const [codeFont, setCodeFont] = useState<CodeFontCSSProperties>(() => ({}));
	useLayoutEffect(() => {
		const measure = () =>
			setCodeFont(codeFontStyle(FontConfigurationManager.getFontInfo(configurationService, 'editor', pageRef.current ?? undefined)));
		measure();
		const disposable = configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('editor')) {
				measure();
			}
		});
		return () => disposable.dispose();
	}, [configurationService]);

	useEffect(() => {
		setDetails(input.details);
		const disposable = input.onDidChangeDetails(() => setDetails(input.details));
		return () => disposable.dispose();
	}, [input]);

	return (
		<div ref={pageRef} className='data-connection-node-details-page' style={codeFont}>
			<div className='data-connection-node-details-top'>
				{/*
				 * Where the node lives: its connection, then each node down to it, as the tree showed
				 * them when the tab was opened. Group rows ("Tables", "Metrics") are left out, as they
				 * are in the tab's key; they only label the rows beneath them.
				 */}
				<nav aria-label={localize('positron.dataConnections.nodeDetails.breadcrumbs', "Location")} className='data-connection-node-details-breadcrumbs'>
					<ol>
						{input.target.path.map((segment, index) => {
							const current = index === input.target.path.length - 1;
							return (
								<li key={index}>
									{index > 0 && <span aria-hidden='true' className='codicon codicon-chevron-right data-connection-node-details-breadcrumb-separator' />}
									<button aria-current={current ? 'location' : undefined} className='data-connection-node-details-breadcrumb' onClick={() => void revealBreadcrumb(index)}>
										{segment}
									</button>
								</li>
							);
						})}
					</ol>
				</nav>
				<div className='data-connection-node-details-header'>
					<div className={`codicon codicon-${input.target.icon} data-connection-node-details-icon`} />
					<div className='data-connection-node-details-heading'>
						<h1 className='data-connection-node-details-name'>{input.target.name}</h1>
						{details.description && (
							<div className='data-connection-node-details-description'>{details.description}</div>
						)}
					</div>
				</div>
			</div>
			{details.tabs && details.tabs.length > 0 ? (
				<PositronTabs
					ariaLabel={localize('positron.dataConnections.nodeDetails.tabs', "Details of {0}", input.target.name)}
					// Tabs are identified by position, which stays the same when a re-click refreshes
					// the details, so the selected tab is kept. Not by title: a title is the driver's
					// free text, and the id ends up in DOM ids and space-separated aria-controls.
					tabs={details.tabs.map((tab, index) => ({
						id: String(index),
						label: tab.title,
						content: <DataConnectionNodeDetailsSections actions={actions} sections={tab.sections} />,
					}))}
				/>
			) : (
				<DataConnectionNodeDetailsSections actions={actions} sections={details.sections} />
			)}
		</div>
	);
};
