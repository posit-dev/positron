/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './layoutCards.css';

// Other dependencies.
import { localize } from '../../../../../../nls.js';
import { Button } from '../../../../../../base/browser/ui/positronComponents/button/button.js';
import { positronSimplifiedLayout } from '../../../../../services/positronLayout/browser/layouts/positronSimplifiedLayout.js';
import { positronFourPaneDsLayout } from '../../../../../services/positronLayout/browser/layouts/positronFourPaneDsLayout.js';
import { positronTwoPaneLayout } from '../../../../../services/positronLayout/browser/layouts/positronTwoPaneLayout.js';
import { positronNotebookLayout } from '../../../../../services/positronLayout/browser/layouts/positronNotebookLayout.js';

/**
 * One area of a layout picture, such as the editor or the column of session views.
 */
interface LayoutRegion {
	/** The grid area name this region fills. */
	readonly area: string;
	/** The names of the views shown in this region, top to bottom. */
	readonly labels: readonly string[];
	/** Whether this region is where files open, which the picture draws stronger. */
	readonly isEditor?: boolean;
}

/**
 * A layout the user can switch to from the welcome page.
 */
export interface LayoutCard {
	/** The command that applies the layout. */
	readonly commandId: string;
	readonly name: string;
	readonly description: string;
	/** CSS grid columns and areas that draw the layout picture. */
	readonly columns: string;
	readonly rows?: string;
	readonly areas: string;
	readonly regions: readonly LayoutRegion[];
}

/**
 * Builds the layout cards. A function rather than a constant so the strings are
 * localized when the page renders, not when this module loads.
 * @returns The cards, in the order they show on the page.
 */
export function getLayoutCards(): LayoutCard[] {
	const files = localize('positron.welcome.layout.files', "Files");
	const editor = localize('positron.welcome.layout.editor', "Editor");
	const notebook = localize('positron.welcome.layout.notebook', "Notebook");
	const consoleLabel = localize('positron.welcome.layout.console', "Console");
	const terminal = localize('positron.welcome.layout.terminal', "Terminal");
	const variables = localize('positron.welcome.layout.variables', "Variables");
	const plots = localize('positron.welcome.layout.plots', "Plots");

	return [
		{
			commandId: positronSimplifiedLayout.id,
			name: localize('positron.welcome.layout.simplifiedName', "Simplified"),
			description: localize('positron.welcome.layout.simplifiedDescription', "Your files, the editor, and one column with the console, terminal, variables, and plots."),
			columns: '1fr 3fr 2fr',
			areas: '"files editor session"',
			regions: [
				{ area: 'files', labels: [files] },
				{ area: 'editor', labels: [editor], isEditor: true },
				{ area: 'session', labels: [consoleLabel, terminal, variables, plots] },
			],
		},
		{
			commandId: positronFourPaneDsLayout.id,
			name: localize('positron.welcome.layout.stackedName', "Stacked"),
			description: localize('positron.welcome.layout.stackedDescription', "The console under the editor, with variables and plots on the right."),
			columns: '1fr 3fr 2fr',
			rows: '3fr 2fr',
			areas: '"files editor session" "files console session"',
			regions: [
				{ area: 'files', labels: [files] },
				{ area: 'editor', labels: [editor], isEditor: true },
				{ area: 'console', labels: [consoleLabel] },
				{ area: 'session', labels: [variables, plots] },
			],
		},
		{
			commandId: positronTwoPaneLayout.id,
			name: localize('positron.welcome.layout.sideBySideName', "Side by Side"),
			description: localize('positron.welcome.layout.sideBySideDescription', "The editor on the left, and the console, variables, and plots on the right."),
			columns: '3fr 2fr',
			areas: '"editor session"',
			regions: [
				{ area: 'editor', labels: [editor], isEditor: true },
				{ area: 'session', labels: [consoleLabel, variables, plots] },
			],
		},
		{
			commandId: positronNotebookLayout.id,
			name: localize('positron.welcome.layout.notebookName', "Notebook"),
			description: localize('positron.welcome.layout.notebookDescription', "A wide notebook, with your files on the left and variables on the right."),
			columns: '1fr 3fr 1.5fr',
			areas: '"files editor variables"',
			regions: [
				{ area: 'files', labels: [files] },
				{ area: 'editor', labels: [notebook], isEditor: true },
				{ area: 'variables', labels: [variables] },
			],
		},
	];
}

/**
 * LayoutCardListProps interface.
 */
export interface LayoutCardListProps {
	/** The id of the element that names the list. */
	readonly labelledBy: string;
	/** The command id of the selected layout, or undefined when none is selected. */
	readonly selectedLayoutId: string | undefined;
	/** The command id of the layout the window is in, which gets a Current badge. */
	readonly currentLayoutId: string | undefined;
	/** Called with a layout's command id when the user picks its card. */
	readonly onSelect: (layoutId: string) => void;
}

/**
 * LayoutCardList component. Shows each layout as a picture the user can pick.
 * Picking a card only selects it; the caller decides when to apply it.
 * @param props A LayoutCardListProps that contains the component properties.
 * @returns The rendered component.
 */
export const LayoutCardList = (props: LayoutCardListProps) => {
	// Render. The cards are radio buttons because exactly one layout is picked at a
	// time. The picture is hidden from screen readers, which read the name and
	// description instead.
	return (
		<div className='layout-cards-container'>
			<div aria-labelledby={props.labelledBy} className='layout-cards' role='radiogroup'>
				{getLayoutCards().map(card => (
					<Button
						key={card.commandId}
						ariaChecked={card.commandId === props.selectedLayoutId}
						className={card.commandId === props.selectedLayoutId ? 'layout-card selected' : 'layout-card'}
						role='radio'
						onPressed={() => props.onSelect(card.commandId)}
					>
						<span
							aria-hidden='true'
							className='layout-card-picture'
							style={{
								gridTemplateColumns: card.columns,
								gridTemplateRows: card.rows,
								gridTemplateAreas: card.areas,
							}}
						>
							{card.regions.map(region => (
								<span
									key={region.area}
									className={region.isEditor ? 'layout-card-region editor' : 'layout-card-region'}
									style={{ gridArea: region.area }}
								>
									{region.labels.map(label => (
										<span key={label} className='layout-card-region-label'>{label}</span>
									))}
								</span>
							))}
						</span>
						<span className='layout-card-name'>
							{card.name}
							{card.commandId === props.currentLayoutId &&
								<span className='layout-card-current-badge'>
									{localize('positron.welcome.layout.current', "Current")}
								</span>
							}
						</span>
						<span className='layout-card-description'>{card.description}</span>
					</Button>
				))}
			</div>
		</div>
	);
};
