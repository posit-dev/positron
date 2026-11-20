/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './assistantCard.css';

// React.
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

// Other dependencies.
import { findParentWithClass } from '../../../../../../base/browser/dom.js';
import { localize } from '../../../../../../nls.js';
import { WelcomeAssistantCard } from '../welcomeAssistantCard.js';

/**
 * AssistantCardProps interface.
 */
export interface AssistantCardProps {
	readonly card: WelcomeAssistantCard;
}

/**
 * AssistantCard component. A fixed-height card on the welcome page that shows
 * the Posit Assistant chat. The chat is a webview owned by the editor pane;
 * this component only marks where it draws.
 * @param props An AssistantCardProps that contains the component properties.
 * @returns The rendered component, or nothing when Assistant is not available.
 */
export const AssistantCard = (props: AssistantCardProps) => {
	const { card } = props;
	const titleId = useId();
	const anchorRef = useRef<HTMLDivElement>(null);
	const [available, setAvailable] = useState(card.available);

	useEffect(() => {
		setAvailable(card.available);
		const listener = card.onDidChangeAvailable(setAvailable);
		return () => listener.dispose();
	}, [card]);

	useLayoutEffect(() => {
		const anchor = anchorRef.current;
		if (!available || !anchor) {
			return;
		}
		// The welcome page scrolls inside this element. Clipping to it keeps
		// the webview from drawing over the editor tabs when scrolled away.
		const clippingContainer = findParentWithClass(anchor, 'monaco-scrollable-element') ?? undefined;
		const attachment = card.attach(anchor, clippingContainer);
		return () => attachment.dispose();
	}, [card, available]);

	if (!available) {
		return null;
	}

	return (
		<section aria-labelledby={titleId} className='positron-welcome-page-assistant'>
			<h2 className='positron-welcome-page-assistant-title' id={titleId}>
				{localize('positron.welcome.assistantCardTitle', "Ask Posit Assistant")}
			</h2>
			{/* The webview covers its anchor's whole box, border included, so
				the card frame is drawn by this wrapper instead. */}
			<div className='positron-welcome-page-assistant-card'>
				{/* The webview is drawn over this element, outside the normal tab
					order. Focusing the element moves focus into the webview. */}
				<div
					ref={anchorRef}
					aria-labelledby={titleId}
					className='positron-welcome-page-assistant-anchor'
					role='document'
					tabIndex={0}
					onFocus={e => {
						if (e.target === e.currentTarget) {
							card.focus();
						}
					}}
				/>
			</div>
		</section>
	);
};
