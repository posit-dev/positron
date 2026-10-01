/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { act, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IViewsService } from '../../../../services/views/common/viewsService.js';
import { IPositronDataConnectionsService } from '../../../../services/positronDataConnections/common/interfaces/positronDataConnectionsService.js';
import { POSITRON_DATA_CONNECTIONS_VIEW_ID } from '../../browser/positronDataConnectionsConfiguration.js';
import { DataConnectionNodeDetailsPage } from '../../browser/editor/dataConnectionNodeDetailsPage.js';
import { DataConnectionNodeDetailsEditorInput, IDataConnectionNodeDetailsTarget } from '../../browser/editor/dataConnectionNodeDetailsEditorInput.js';
import { IDataConnectionNodeDetailsDTO, IDataConnectionNodeDetailsSectionDTO } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionDTOs.js';

const TARGET: IDataConnectionNodeDetailsTarget = {
	key: '["entry:conn-1","[\\"semantic-view\\",\\"CHAOS_MODEL\\"]"]',
	name: 'CHAOS_MODEL',
	icon: 'type-hierarchy',
	path: ['TestData', 'DEMO_CHAOS_DB', 'ERP_DUMP', 'CHAOS_MODEL'],
	profileId: 'conn-1',
	// Every row on the way down, group rows included; each breadcrumb ends somewhere along it.
	nodePath: [
		'["group-databases","Databases"]', '["database","DEMO_CHAOS_DB"]',
		'["group-schemas","Schemas"]', '["schema","ERP_DUMP"]',
		'["group-semantic-views","Semantic Views"]', '["semantic-view","CHAOS_MODEL"]',
	],
	breadcrumbNodePathLengths: [0, 2, 4, 6],
	canPreview: false,
};

// A semantic view's details, shaped the way the Snowflake driver builds them: an Overview holding a
// logical table's collapsible member groups, and a Definition holding the DDL.
function semanticViewDetails(ddl: string): IDataConnectionNodeDetailsDTO {
	return {
		description: 'Semantic view in DEMO_CHAOS_DB.ERP_DUMP',
		sections: [],
		tabs: [
			{
				title: 'Overview',
				sections: [{
					kind: 'group',
					title: 'Logical Tables',
					count: 1,
					sections: [{
						kind: 'group',
						title: 'REF_ENTITIES',
						sections: [
							{
								kind: 'group', title: 'Dimensions', count: 1, collapsible: true,
								treePath: [{ kind: 'group-logical-tables', name: 'Logical Tables' }, { kind: 'logical-table', name: 'REF_ENTITIES' }, { kind: 'group-dimensions', name: 'Dimensions' }],
								sections: [{
									kind: 'items', title: 'Keys', emptyText: 'No dimensions', items: [
										{ name: 'ACC_TYPE_CD', kind: 'dimension', dataType: 'VARCHAR(3)', code: 'ACC_TYPE_CD' },
									],
								}],
							},
							{ kind: 'group', title: 'Metrics', count: 0, collapsible: true, sections: [{ kind: 'items', emptyText: 'No metrics', items: [] }] },
						],
					}],
				}],
			},
			{ title: 'Definition', sections: [{ kind: 'code', languageId: 'sql', code: ddl }] },
		],
	};
}

// An items section holding a text dimension, a numeric dimension, a metric, a Snowflake timestamp
// time dimension, and a dimension of a type with no icon of its own, for the icon and layout tests.
const ITEMS: IDataConnectionNodeDetailsSectionDTO = {
	kind: 'items',
	items: [
		{ name: 'ENTITY_NAME', kind: 'dimension', dataType: 'VARCHAR(25)', code: 'ENTITY_NAME' },
		{ name: 'N_ID', kind: 'dimension', dataType: 'NUMBER(38,0)', code: 'N_ID' },
		{
			name: 'NET_REVENUE',
			kind: 'metric',
			dataType: 'NUMBER(37,4)',
			description: 'Realized revenue (Status 90).',
			code: 'SUM(X_AMT)',
		},
		// Snowflake spells its timestamps with a suffix, which the date/time pattern must still match.
		{ name: 'LOG_TS', kind: 'time-dimension', dataType: 'TIMESTAMP_NTZ(9)' },
		{ name: 'PAYLOAD', kind: 'dimension', dataType: 'VARIANT' },
	],
};

describe('DataConnectionNodeDetailsPage', () => {
	// The page reads the editor font from the configuration service; an empty editor section means
	// the defaults, as in a fresh profile. Built before the renderer so the container's leak check
	// runs after RTL has unmounted the page: afterEach hooks run in reverse, and the page holds its
	// input subscription until unmount.
	// A breadcrumb opens the pane and asks the service to reveal its node.
	const openView = vi.fn(async () => undefined);
	const revealConnection = vi.fn();
	const ctx = createTestContainer()
		.withReactServices()
		.stub(IConfigurationService, new TestConfigurationService({ editor: {} }))
		.stub(IViewsService, { openView })
		.stub(IPositronDataConnectionsService, { revealConnection })
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	// The details' own list entries, leaving out the breadcrumbs (also a list) above them.
	function detailItems() {
		const breadcrumbs = screen.getByRole('navigation', { name: 'Location' });
		return screen.getAllByRole('listitem').filter(item => !breadcrumbs.contains(item));
	}

	function renderPage(details: IDataConnectionNodeDetailsDTO, target: IDataConnectionNodeDetailsTarget = TARGET) {
		const input = ctx.disposables.add(new DataConnectionNodeDetailsEditorInput(target, details));
		rtl.render(<DataConnectionNodeDetailsPage input={input} />);
		return input;
	}

	describe('page', () => {
		it('shows the node\'s name and description over its properties, code, and table sections', () => {
			renderPage({
				description: 'Metric in DEMO_CHAOS_DB.ERP_DUMP.CHAOS_MODEL',
				sections: [
					{ kind: 'properties', properties: [{ name: 'Table', value: 'T_DATA_LOG' }, { name: 'Data Type', value: 'NUMBER(37,4)' }] },
					{ kind: 'code', title: 'Expression', languageId: 'sql', code: 'SUM(X_AMT)' },
					{ kind: 'table', title: 'Files', columns: ['Name', 'Size'], rows: [['data.csv', '1024']] },
				],
			});

			expect(screen.getByRole('heading', { level: 1, name: 'CHAOS_MODEL' })).toBeInTheDocument();
			expect(screen.getByText('Metric in DEMO_CHAOS_DB.ERP_DUMP.CHAOS_MODEL')).toBeInTheDocument();
			const terms = screen.getAllByRole('term').map(term => term.textContent);
			const definitions = screen.getAllByRole('definition').map(definition => definition.textContent);
			expect(terms.map((term, index) => `${term}: ${definitions[index]}`)).toMatchInlineSnapshot(`
				[
				  "Table: T_DATA_LOG",
				  "Data Type: NUMBER(37,4)",
				]
			`);
			expect(screen.getByRole('heading', { name: 'Expression' })).toBeInTheDocument();
			expect(screen.getByText('SUM(X_AMT)')).toBeInTheDocument();
			expect(screen.getByRole('row', { name: 'data.csv 1024' })).toBeInTheDocument();
		});

		it('treats an empty tab list as no tabs, showing the sections', () => {
			renderPage({ sections: [{ kind: 'code', code: 'SELECT 1' }], tabs: [] });

			expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
			expect(screen.getByText('SELECT 1')).toBeInTheDocument();
		});

		it('shows where the node lives as breadcrumbs, ending at the node itself', () => {
			renderPage({ sections: [] });

			const breadcrumbs = within(screen.getByRole('navigation', { name: 'Location' })).getAllByRole('listitem');
			expect(breadcrumbs.map(crumb => crumb.textContent)).toEqual(['TestData', 'DEMO_CHAOS_DB', 'ERP_DUMP', 'CHAOS_MODEL']);
			// On the breadcrumb itself, the element a screen reader lands on.
			expect(screen.getByRole('button', { name: 'CHAOS_MODEL' })).toHaveAttribute('aria-current', 'location');
			expect(screen.getByRole('button', { name: 'TestData' })).not.toHaveAttribute('aria-current');
		});

		it('reveals a breadcrumb\'s node in the pane, opening its details, and the connection alone for the first', async () => {
			renderPage({ sections: [] });
			const user = userEvent.setup();

			await user.click(screen.getByRole('button', { name: 'ERP_DUMP' }));

			// Focus stays in the editor, for every breadcrumb alike.
			expect(openView).toHaveBeenCalledWith(POSITRON_DATA_CONNECTIONS_VIEW_ID, false);
			expect(revealConnection).toHaveBeenLastCalledWith('conn-1', {
				nodePath: TARGET.nodePath.slice(0, 4),
				openDetails: true,
				preserveFocus: true,
			});

			await user.click(screen.getByRole('button', { name: 'TestData' }));

			expect(revealConnection).toHaveBeenLastCalledWith('conn-1', { nodePath: [], openDetails: false, preserveFocus: true });
		});

		it('opens a previewable node in the Data Explorer through the tree, leaving focus where it lands', async () => {
			renderPage({ sections: [] }, { ...TARGET, canPreview: true });
			const user = userEvent.setup();

			await user.click(screen.getByRole('button', { name: 'Open in Data Explorer' }));

			expect(revealConnection).toHaveBeenLastCalledWith('conn-1', { nodePath: TARGET.nodePath, openInDataExplorer: true, preserveFocus: true });
		});

		it('offers no Data Explorer button for a node that can\'t preview', () => {
			renderPage({ sections: [] });

			expect(screen.queryByRole('button', { name: 'Open in Data Explorer' })).not.toBeInTheDocument();
		});

		it('says so when the node has no details', () => {
			renderPage({ sections: [] });

			expect(screen.getByText('No details are available for this item.')).toBeInTheDocument();
		});

		it('splits tabbed details into a tab strip, showing the first tab until another is chosen', async () => {
			renderPage(semanticViewDetails('create semantic view CHAOS_MODEL'));
			const user = userEvent.setup();

			expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
			expect(screen.getByText('create semantic view CHAOS_MODEL')).not.toBeVisible();

			await user.click(screen.getByRole('tab', { name: 'Definition' }));

			expect(screen.getByText('create semantic view CHAOS_MODEL')).toBeVisible();
			// Hidden elements are left out of role queries unless asked for, which is the point here.
			expect(screen.getByRole('heading', { name: 'Logical Tables 1', hidden: true })).not.toBeVisible();
		});

		it('links each tab to its panel whatever its title, spaces included', () => {
			renderPage({ sections: [], tabs: [
				{ title: 'Sample Data', sections: [{ kind: 'code', code: 'SELECT 1' }] },
				{ title: 'Definition', sections: [{ kind: 'code', code: 'CREATE' }] },
			] });

			// A title spliced into an id would give aria-controls two bogus ids here, and the panel no
			// name; named by the tab that controls it, the panel is found.
			expect(screen.getByRole('tabpanel', { name: 'Sample Data' })).toHaveTextContent('SELECT 1');
		});

		it('updates in place when the details are refreshed, keeping the selected tab', async () => {
			const input = renderPage(semanticViewDetails('create semantic view CHAOS_MODEL'));
			const user = userEvent.setup();
			await user.click(screen.getByRole('tab', { name: 'Definition' }));

			// What clicking the node again in the tree does to an open tab.
			act(() => input.setDetails(semanticViewDetails('create or replace semantic view CHAOS_MODEL')));

			expect(screen.getByRole('tab', { name: 'Definition' })).toHaveAttribute('aria-selected', 'true');
			expect(screen.getByText('create or replace semantic view CHAOS_MODEL')).toBeVisible();
		});
	});

	describe('groups and items', () => {
		it('steps nested headings down a level each, stopping at h4', () => {
			renderPage(semanticViewDetails('ddl'));

			// The node's name is the h1; "Keys" sits a level below Dimensions but is held at h4.
			expect(screen.getAllByRole('heading').map(heading => `${heading.tagName}: ${heading.textContent}`)).toMatchInlineSnapshot(`
				[
				  "H1: CHAOS_MODEL",
				  "H2: Logical Tables1",
				  "H3: REF_ENTITIES",
				  "H4: Dimensions1",
				  "H4: Keys",
				  "H4: Metrics0",
				]
			`);
		});

		it('shows a group\'s tree node in the pane, below this node, from its heading\'s button', async () => {
			renderPage(semanticViewDetails('ddl'));
			const user = userEvent.setup();

			// The button sits beside the heading, not in it, so the heading is named by its title.
			expect(screen.getByRole('heading', { name: 'Dimensions 1' })).toBeInTheDocument();

			// Only groups that name a tree node get the button.
			expect(screen.queryByRole('button', { name: 'Show Metrics in Data Connections' })).not.toBeInTheDocument();
			await user.click(screen.getByRole('button', { name: 'Show Dimensions in Data Connections' }));

			// Revealed without its details, so the tree takes focus: the user asked to go there.
			expect(revealConnection).toHaveBeenLastCalledWith('conn-1', {
				nodePath: [
					...TARGET.nodePath,
					'["group-logical-tables","Logical Tables"]',
					'["logical-table","REF_ENTITIES"]',
					'["group-dimensions","Dimensions"]',
				],
			});
		});

		it('shows a group\'s count, and collapses and re-expands a collapsible group\'s contents', async () => {
			renderPage(semanticViewDetails('ddl'));
			const user = userEvent.setup();
			// Only collapsible groups get a toggle; Logical Tables is a plain heading.
			expect(screen.queryByRole('button', { name: 'Logical Tables 1' })).not.toBeInTheDocument();
			const toggle = screen.getByRole('button', { name: 'Dimensions 1' });
			// By the name's own element: ACC_TYPE_CD is also the text of the item's code chip.
			expect(toggle).toHaveAttribute('aria-expanded', 'true');
			expect(screen.getByText('ACC_TYPE_CD', { selector: '.data-connection-node-details-item-name' })).toBeInTheDocument();

			await user.click(toggle);

			expect(toggle).toHaveAttribute('aria-expanded', 'false');
			expect(screen.queryByText('ACC_TYPE_CD', { selector: '.data-connection-node-details-item-name' })).not.toBeInTheDocument();

			await user.click(toggle);

			expect(toggle).toHaveAttribute('aria-expanded', 'true');
			expect(screen.getByText('ACC_TYPE_CD', { selector: '.data-connection-node-details-item-name' })).toBeInTheDocument();
		});

		it('shows an item\'s name, description, code, and data type, and an empty group\'s placeholder', () => {
			renderPage({ sections: [ITEMS, { kind: 'items', items: [], emptyText: 'No named filters' }] });

			const metric = within(detailItems()[2]);
			expect(metric.getByText('NET_REVENUE')).toBeInTheDocument();
			expect(metric.getByText('Realized revenue (Status 90).')).toBeInTheDocument();
			expect(metric.getByText('SUM(X_AMT)')).toBeInTheDocument();
			expect(metric.getByText('NUMBER(37,4)')).toBeInTheDocument();
			expect(screen.getByText('No named filters')).toBeInTheDocument();
		});

		it('marks a typed value by its data type, and anything else by its kind', () => {
			renderPage({ sections: [ITEMS] });

			// The icons are decorative codicons with no role, name, or text, so their class is the only
			// thing that tells them apart.
			const iconOf = (item: HTMLElement) =>
				// eslint-disable-next-line no-restricted-syntax -- decorative codicon; see above
				Array.from(item.querySelector('.data-connection-node-details-item-icon')?.classList ?? []).find(name => name.startsWith('codicon-'));
			expect(detailItems().map(iconOf)).toMatchInlineSnapshot(`
				[
				  "codicon-symbol-string",
				  "codicon-symbol-numeric",
				  "codicon-graph",
				  "codicon-calendar",
				  "codicon-symbol-field",
				]
			`);
		});
	});
});
