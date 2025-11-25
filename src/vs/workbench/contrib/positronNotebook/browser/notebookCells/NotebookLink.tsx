/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React from 'react';

// Other dependencies.
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { useNotebookInstance } from '../NotebookInstanceProvider.js';

interface NotebookLinkProps extends React.ComponentPropsWithoutRef<'a'> {
}

/**
 * Link component for notebook markdown cells that handles anchor links by scrolling
 * within the notebook instead of trying to open them as files.
 *
 * For anchor links (href starting with #), this component finds the target element
 * within the notebook and scrolls to it. For other links, it delegates to the
 * opener service like ExternalLink does.
 *
 * @param props The props for the link component.
 * @returns The rendered link component.
 */
export function NotebookLink(props: NotebookLinkProps) {
	// Context hooks.
	const services = usePositronReactServicesContext();
	const notebookInstance = useNotebookInstance();

	const { href, ...otherProps } = props;

	const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
		if (!href) {
			return;
		}

		// Check if this is an anchor link (starts with #)
		const trimmedHref = href.trim();
		if (trimmedHref.startsWith('#')) {
			e.preventDefault();

			// Extract the anchor ID (remove the #)
			const anchorId = trimmedHref.substring(1);
			if (!anchorId) {
				// Empty anchor, scroll to top
				if (notebookInstance.cellsContainer) {
					notebookInstance.cellsContainer.scrollTo({ top: 0, behavior: 'smooth' });
				}
				return;
			}

			// Find the target element within the notebook
			// Search within the cells container and all its descendants
			if (notebookInstance.cellsContainer) {
				const targetElement = notebookInstance.cellsContainer.querySelector(`#${CSS.escape(anchorId)}`) as HTMLElement | null;

				if (targetElement) {
					// Scroll the target element into view
					targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
				}
				// If element not found, silently fail (anchor link points to non-existent target)
			}
		} else {
			// Not an anchor link, use opener service like ExternalLink
			e.preventDefault();
			services.openerService.open(href);
		}
	};

	return <a
		{...otherProps}
		href={href}
		onClick={handleClick}
	>
		{props.children}
	</a>;
}

