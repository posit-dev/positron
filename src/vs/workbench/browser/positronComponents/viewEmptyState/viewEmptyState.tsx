/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './viewEmptyState.css';

// Other dependencies.
import { localize } from '../../../../nls.js';
import { Button } from '../../../../base/browser/ui/positronComponents/button/button.js';
import { usePositronReactServicesContext } from '../../../../base/browser/positronReactRendererContext.js';
import { URI } from '../../../../base/common/uri.js';
import { IPositronDocsService } from '../../../services/positronDocs/browser/positronDocsService.js';

const viewDocumentation = localize('positron.viewEmptyState.viewDocumentation', "View Documentation");

/**
 * ViewEmptyStateProps interface.
 */
export interface ViewEmptyStateProps {
	/** The codicon ID of the icon, without the `codicon-` prefix. */
	readonly icon: string;
	/** One sentence that says what appears in the view. */
	readonly message: string;
	/** The docs page for the view, as a path under the docs site. */
	readonly docsPath: string;
	/**
	 * The accessible name of the docs button. Several views can show this
	 * component at once, and each button has the same visible label, so this
	 * name has to say which view it is for.
	 */
	readonly docsAriaLabel: string;
}

/**
 * ViewEmptyState component. What a view shows when it has nothing to show yet:
 * an icon, a sentence, and a button that opens the view's documentation.
 * @param props A ViewEmptyStateProps that contains the component properties.
 * @returns The rendered component.
 */
export const ViewEmptyState = (props: ViewEmptyStateProps) => {
	const services = usePositronReactServicesContext();

	const openDocs = async () => {
		const url = services.get(IPositronDocsService).getUrl(props.docsPath);
		await services.openerService.open(URI.parse(url));
	};

	// Render.
	return (
		<div className='view-empty-state'>
			<span aria-hidden='true' className={`view-empty-state-icon codicon codicon-${props.icon}`} />
			<div className='view-empty-state-message'>{props.message}</div>
			<Button ariaLabel={props.docsAriaLabel} className='view-empty-state-action' onPressed={openDocs}>
				<span aria-hidden='true' className='view-empty-state-action-icon codicon codicon-link-external' />
				{viewDocumentation}
			</Button>
		</div>
	);
};
