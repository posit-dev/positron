/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React from 'react';

// Other dependencies.
import { URI } from '../../../../../base/common/uri.js';
import { dirname } from '../../../../../base/common/resources.js';
import { Schemas } from '../../../../../base/common/network.js';
import { IPathService } from '../../../../services/path/common/pathService.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { useNotebookInstance } from '../NotebookInstanceProvider.js';

const FRAGMENT_REGEX = /^(.*)#([^#]*)$/;

/**
 * Resolves a markdown link href against the notebook's location.
 * Mirrors upstream `_handleResourceOpening` in
 * src/vs/workbench/contrib/notebook/browser/view/renderers/backLayerWebView.ts
 * (which is private, so we port the logic locally per upstream-compat policy).
 */
export async function resolveNotebookLinkTarget(
	href: string,
	notebookUri: URI,
	pathService: IPathService,
	workspaceContextService: IWorkspaceContextService,
): Promise<URI | undefined> {
	// Separate the fragment so URI.joinPath doesn't URL-encode it.
	let fragment: string | undefined;
	const m = FRAGMENT_REGEX.exec(href);
	if (m) {
		href = m[1];
		fragment = m[2];
	}

	let target: URI | undefined;
	if (href.startsWith('/')) {
		target = await pathService.fileURI(href);
		const folders = workspaceContextService.getWorkspace().folders;
		if (folders.length) {
			target = target.with({
				scheme: folders[0].uri.scheme,
				authority: folders[0].uri.authority,
			});
		}
	} else if (href.startsWith('~')) {
		const userHome = await pathService.userHome();
		if (userHome) {
			target = URI.joinPath(userHome, href.substring(2));
		}
	} else {
		if (notebookUri.scheme === Schemas.untitled) {
			const folders = workspaceContextService.getWorkspace().folders;
			if (!folders.length) {
				return undefined;
			}
			target = URI.joinPath(folders[0].uri, href);
		} else {
			target = URI.joinPath(dirname(notebookUri), href);
		}
	}

	if (target && fragment !== undefined) {
		target = target.with({ fragment });
	}
	return target;
}

interface NotebookLinkProps extends React.ComponentPropsWithoutRef<'a'> {
}

const SCHEME_REGEX = /^[\w\-]+:/;

function tryDecodeURIComponent(uri: string): string {
	try { return decodeURIComponent(uri); } catch { return uri; }
}

/**
 * Link component for notebook markdown cells. Resolves relative paths against
 * the notebook's location, mirroring the legacy notebook editor's behavior.
 * Anchors (#section) are left to the browser. Other schemed hrefs (http,
 * command, mailto, file, etc.) are passed to openerService unchanged.
 *
 * Keyboard activation (Enter/Space) is handled for accessibility.
 *
 * @param props The props for the link component.
 * @returns The rendered link component.
 */
export function NotebookLink(props: NotebookLinkProps) {
	// Context hooks.
	const services = usePositronReactServicesContext();
	const instance = useNotebookInstance();

	const { href, ...otherProps } = props;

	/**
	 * Activates the link. Returns true if the opener service will handle it,
	 * false if the browser should (anchors, or unresolvable hrefs).
	 */
	const activateLink = async (): Promise<boolean> => {
		if (!href) { return false; }
		if (href.trim().startsWith('#')) { return false; }
		if (SCHEME_REGEX.test(href)) {
			services.openerService.open(href);
			return true;
		}
		const target = await resolveNotebookLinkTarget(
			tryDecodeURIComponent(href),
			instance.uri,
			services.pathService,
			services.workspaceContextService,
		);
		if (target) {
			services.openerService.open(target);
			return true;
		}
		return false;
	};

	// Heuristic: we'll handle anything non-empty that isn't a pure anchor.
	// Must preventDefault synchronously -- can't wait on the async activate.
	const willHandle = !!href && !href.trim().startsWith('#');

	const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
		if (willHandle) { e.preventDefault(); }
		activateLink().catch(() => { /* errors surface via openerService dialogs */ });
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
			if (willHandle) { e.preventDefault(); }
			activateLink().catch(() => { /* see handleClick */ });
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

