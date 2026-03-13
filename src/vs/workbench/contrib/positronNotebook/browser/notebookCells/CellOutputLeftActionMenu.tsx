/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './CellOutputLeftActionMenu.css';

// React.
import { useMemo, useRef, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { IAction, toAction } from '../../../../../base/common/actions.js';
import { ActionButton } from '../utilityComponents/ActionButton.js';
import { useNotebookInstance } from '../NotebookInstanceProvider.js';
import { PositronNotebookCodeCell } from '../PositronNotebookCells/PositronNotebookCodeCell.js';
import { useObservedValue } from '../useObservedValue.js';
import { Icon } from '../../../../../platform/positronActionBar/browser/components/icon.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { useCellContextMenu } from './useCellContextMenu.js';
import { MenuId } from '../../../../../platform/actions/common/actions.js';
import { POSITRON_NOTEBOOK_OUTPUT_IMAGE_TARGETED } from '../ContextKeysManager.js';
import { useCellScopedContextKeyService } from './CellContextKeyServiceProvider.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';

const cellOutputActions = localize('cellOutputActions', 'Cell Output Actions');

/**
 * Shape of the arg passed to `positronNotebook.cell.copyOutputImage` to target
 * a specific image. Must match the interface in positronNotebook.contribution.ts.
 */
interface CopyImageMenuArg {
	imageDataUrl: string;
}

interface CellOutputLeftActionMenuProps {
	cell: PositronNotebookCodeCell;
}

/**
 * The left action menu for notebook cell output actions.
 * Uses the native context menu service to display actions registered to
 * MenuId.PositronNotebookCellOutputActionLeft.
 * @param cell The cell that the menu actions will operate on
 */
export function CellOutputLeftActionMenu({ cell }: CellOutputLeftActionMenuProps) {
	const instance = useNotebookInstance();
	const { commandService } = usePositronReactServicesContext();
	const contextKeyService = useCellScopedContextKeyService();
	const outputImageTargeted = useMemo(
		() => contextKeyService ? POSITRON_NOTEBOOK_OUTPUT_IMAGE_TARGETED.bindTo(contextKeyService) : undefined,
		[contextKeyService]
	);
	const { showContextMenu } = useCellContextMenu({
		cell,
		menuId: MenuId.PositronNotebookCellOutputActionLeft,
	});

	const buttonRef = useRef<HTMLButtonElement>(null);
	const [isMenuOpen, setIsMenuOpen] = useState(false);

	// Check if there are outputs to determine if we should render the menu
	const outputs = useObservedValue(cell.outputs);
	const hasOutputs = outputs.length > 0;

	const handleShowContextMenu = () => {
		if (!buttonRef.current) {
			return;
		}

		const imageOutputs = outputs.filter(o => o.parsed.type === 'image');

		// For a single image, show the static "Copy Image" action.
		// For multiple images, hide the static action and inject dynamic per-plot actions.
		const hasMultipleImages = imageOutputs.length > 1;
		outputImageTargeted?.set(imageOutputs.length === 1);

		const getActions = hasMultipleImages ? (): IAction[] => {
			const MAX_PLOT_COPY_ACTIONS = 5;
			const limit = Math.min(imageOutputs.length, MAX_PLOT_COPY_ACTIONS);
			const actions: IAction[] = [];

			for (let i = 0; i < limit; i++) {
				const parsed = imageOutputs[i].parsed;
				if (parsed.type === 'image') {
					const imageDataUrl = parsed.dataUrl;
					actions.push(toAction({
						id: `positronNotebook.cell.copyOutputImage.${i}`,
						label: localize('positronNotebook.cell.copyPlotN', "Copy Plot {0}", i + 1),
						run: () => commandService.executeCommand(
							'positronNotebook.cell.copyOutputImage',
							{ imageDataUrl } satisfies CopyImageMenuArg,
						),
					}));
				}
			}

			if (imageOutputs.length > MAX_PLOT_COPY_ACTIONS) {
				actions.push(toAction({
					id: 'positronNotebook.cell.copyOutputImage.hint',
					label: localize('positronNotebook.cell.copyPlotHint', "Right-click to copy additional plots"),
					enabled: false,
					run: () => { },
				}));
			}

			return actions;
		} : undefined;

		setIsMenuOpen(true);
		showContextMenu(buttonRef.current, getActions, () => {
			outputImageTargeted?.set(false);
			setIsMenuOpen(false);
		});
	};

	// Don't render if the cell has no outputs
	if (!hasOutputs) {
		return null;
	}

	return (
		<div className='cell-output-left-action-menu'>
			<ActionButton
				ref={buttonRef}
				aria-expanded={isMenuOpen}
				aria-haspopup='menu'
				ariaLabel={cellOutputActions}
				hoverManager={instance.hoverManager}
				tooltip={cellOutputActions}
				onPressed={handleShowContextMenu}
			>
				<Icon className='button-icon' icon={Codicon.ellipsis} />
			</ActionButton>
		</div>
	);
}
