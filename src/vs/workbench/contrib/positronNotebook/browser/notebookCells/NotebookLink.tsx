/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React from 'react';

// Other dependencies.
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';

interface NotebookLinkProps extends React.ComponentPropsWithoutRef<'a'> {
}

/**
 * Link component for notebook markdown cells that handles anchor links by letting
 * the browser handle them with default behavior. For other links, it delegates to
 * the opener service like ExternalLink does.
 *
 * This component also handles keyboard activation (Enter/Space) to ensure links
 * are accessible when tabbing through rendered markdown content.
 *
 * @param props The props for the link component.
 * @returns The rendered link component.
 */
export function NotebookLink(props: NotebookLinkProps) {
	// Context hooks.
	const services = usePositronReactServicesContext();

	const { href, ...otherProps } = props;

	/**
	 * Activates the link, either by letting the browser handle anchor links
	 * or by using the opener service for other links.
	 * @returns true if the link was handled by the opener service, false if handled by browser
	 */
	const activateLink = (): boolean => {
		if (!href) {
			return false;
		}

		const isAnchorLink = href.trim().startsWith('#');

		// For anchor links, let browser handle with default behavior
		if (isAnchorLink) {
			return false;
		}

		// For other links, use opener service
		services.openerService.open(href);
		return true;
	};

	const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
		const linkHandled = activateLink();
		// If the link was handled by the opener service, prevent default browser navigation
		if (linkHandled) {
			e.preventDefault();
		}
	};

	/**
	 * Handle keyboard activation for accessibility.
	 * Enter and Space should activate the link, similar to a click.
	 * We stop propagation to prevent the notebook's Enter keybinding from
	 * triggering edit mode when the user intends to follow a link.
	 */
	const handleKeyDown = (e: React.KeyboardEvent<HTMLAnchorElement>) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.stopPropagation();
			if (activateLink()) {
				e.preventDefault();
			}
		}
	};

	return <a
		{...otherProps}
		href={href}
		onClick={handleClick}
		onKeyDown={handleKeyDown}
	>
		{props.children}
	</a>;
}

