/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { MenuItemAction } from '../../../../../platform/actions/common/actions.js';
import { Icon } from '../../../../../platform/positronActionBar/browser/components/icon.js';
import type { IInlineDataExplorerActionContext } from './InlineDataExplorerActions.js';

/**
 * Renders one action registered against
 * {@link MenuId.PositronNotebookInlineDataExplorerHeader} as a button styled
 * to match the existing inline data explorer header buttons. Invokes
 * `action.run(ctx)` on click.
 */
export function InlineDataExplorerActionButton({ action, context }: {
	action: MenuItemAction;
	context: IInlineDataExplorerActionContext;
}) {
	return (
		<button
			aria-label={action.label}
			className='inline-data-explorer-open-button'
			title={action.tooltip && action.tooltip.length > 0 ? action.tooltip : action.label}
			type='button'
			onClick={() => action.run(context)}
		>
			{action.item.icon && <Icon icon={action.item.icon} />}
			<span className='inline-data-explorer-open-button-label'>{action.label}</span>
		</button>
	);
}
