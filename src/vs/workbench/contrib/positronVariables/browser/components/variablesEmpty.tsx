/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './variablesEmpty.css';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { ViewEmptyState } from '../../../../browser/positronComponents/viewEmptyState/viewEmptyState.js';
import { usePositronVariablesContext } from '../positronVariablesContext.js';

// VariablesEmptyProps interface.
interface VariablesEmptyProps {
	initializing: boolean;
}

/**
 * Localized strings.
 */
const titleFilter = localize('positron.noVariables.filter', 'No variables match the current filter.');
const variablesHint = localize('positron.variables.empty.variablesHint', "Variables created in your session appear here.");
const docsAriaLabel = localize('positron.variables.empty.docsAriaLabel', "View documentation for the Variables pane");

/**
 * VariablesEmpty component.
 * @param props A VariablesEmptyProps that contains the component properties.
 * @returns The rendered component.
 */
export const VariablesEmpty = (props: VariablesEmptyProps) => {

	const context = usePositronVariablesContext();
	const hasFilter = context.activePositronVariablesInstance?.hasFilterText();

	if (props.initializing) {
		return <div className='variables-empty'>
			<div className='title'>...</div>
		</div>;
	}

	// Someone who typed a filter that matched nothing needs to hear that, not
	// an introduction to the pane.
	if (hasFilter) {
		return <div className='variables-empty'>
			<div className='title'>{titleFilter}</div>
		</div>;
	}

	return <div className='variables-empty variables-empty-intro'>
		<ViewEmptyState
			docsAriaLabel={docsAriaLabel}
			docsPath='variables-pane.html'
			icon='positron-variables'
			message={variablesHint} />
	</div>;
};
