/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './FindWidget.css';

// React.
import React, { useEffect, useRef, useState } from 'react';

// Other dependencies.
import { PositronModalReactRenderer } from '../../../../../../base/browser/positronModalReactRenderer.js';
import { ActionButton } from '../../utilityComponents/ActionButton.js';

export interface FindWidgetProps {
	readonly renderer: PositronModalReactRenderer;
	readonly searchInput?: string;
	readonly focusInput?: boolean;
}

export const FindWidget = ({ renderer, searchInput = '', focusInput = true }: FindWidgetProps) => {
	const [findText, setFindText] = useState(searchInput);
	const [matchCase, setMatchCase] = useState(false);
	const [matchWholeWord, setMatchWholeWord] = useState(false);
	const [useRegex, setUseRegex] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);

	// Handle Escape key to close
	useEffect(() => {
		const disposable = renderer.onKeyDown(e => {
			if (e.code === 'Escape') {
				e.preventDefault();
				e.stopPropagation();
				renderer.dispose();
			}
		});
		return () => disposable.dispose();
	}, [renderer]);

	// Focus input when requested
	useEffect(() => {
		if (focusInput) {
			inputRef.current?.focus();
			inputRef.current?.select();
		}
	}, [focusInput]);

	return (
		<div className='positron-find-widget-positioned'>
			<div className='positron-find-widget'>
				<div className='find-widget-row'>
					<div className='find-input-container'>
						<input
							ref={inputRef}
							className='find-input'
							placeholder='Find'
							type='text'
							value={findText}
							onChange={(e) => setFindText(e.target.value)}
						/>
						<div className='find-input-buttons'>
							<ActionButton
								ariaLabel='Match Case'
								className={`find-action-button ${matchCase ? 'active' : ''}`}
								onPressed={() => setMatchCase(!matchCase)}
							>
								<div className='codicon codicon-case-sensitive' />
							</ActionButton>
							<ActionButton
								ariaLabel='Match Whole Word'
								className={`find-action-button ${matchWholeWord ? 'active' : ''}`}
								onPressed={() => setMatchWholeWord(!matchWholeWord)}
							>
								<div className='codicon codicon-whole-word' />
							</ActionButton>
							<ActionButton
								ariaLabel='Use Regular Expression'
								className={`find-action-button ${useRegex ? 'active' : ''}`}
								onPressed={() => setUseRegex(!useRegex)}
							>
								<div className='codicon codicon-regex' />
							</ActionButton>
							<ActionButton
								ariaLabel='Find in Selection'
								className='find-action-button'
								onPressed={() => { }}
							>
								<div className='codicon codicon-selection' />
							</ActionButton>
						</div>
					</div>
					<div className='find-results'>
						{findText ? 'No results' : ''}
					</div>
					<div className='find-navigation-buttons'>
						<ActionButton
							ariaLabel='Previous Match'
							className='find-action-button'
							onPressed={() => { }}
						>
							<div className='codicon codicon-arrow-up' />
						</ActionButton>
						<ActionButton
							ariaLabel='Next Match'
							className='find-action-button'
							onPressed={() => { }}
						>
							<div className='codicon codicon-arrow-down' />
						</ActionButton>
					</div>
					<ActionButton
						ariaLabel='Close'
						className='find-action-button find-close-button'
						onPressed={() => renderer.dispose()}
					>
						<div className='codicon codicon-close' />
					</ActionButton>
				</div>
			</div>
		</div>
	);
}

export interface PositronFindWidgetOptions {
	readonly container: HTMLElement;
}

// Track active find widget renderer per container
const activeFindWidgets = new WeakMap<HTMLElement, PositronModalReactRenderer>();

export function showPositronFindWidget({ container }: PositronFindWidgetOptions) {
	// If there's already an active find widget for this container, focus it
	const existingRenderer = activeFindWidgets.get(container);
	if (existingRenderer) {
		// Re-render with focusInput=true to focus the input
		existingRenderer.render(
			<FindWidget
				focusInput={true}
				renderer={existingRenderer}
			/>
		);
		return;
	}

	// Create new renderer
	const renderer = new PositronModalReactRenderer({
		container,
		disableCaptures: true, // permits the usage of the enter key where applicable
		onDisposed: () => {
			activeFindWidgets.delete(container);
		}
	});

	// Track the renderer
	activeFindWidgets.set(container, renderer);

	renderer.render(
		<FindWidget
			focusInput={true}
			renderer={renderer}
		/>
	);
}
