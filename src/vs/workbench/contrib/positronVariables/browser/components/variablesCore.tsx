/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './variablesCore.css';

// React.
import { useEffect, useRef } from 'react';

// Other dependencies.
import { IReactComponentContainer } from '../../../../../base/browser/positronReactRenderer.js';
import { ActionBars } from './actionBars.js';
import { PositronVariablesProps } from '../positronVariables.js';
import { VariablesInstance } from './variablesInstance.js';
import { usePositronVariablesContext } from '../positronVariablesContext.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ProgressBar } from '../../../../../base/browser/ui/progressbar/progressbar.js';
import { RuntimeClientStatus } from '../../../../services/languageRuntime/common/languageRuntimeClientInstance.js';

// VariablesCoreProps interface.
interface VariablesCoreProps extends PositronVariablesProps {
	readonly width: number;
	readonly height: number;
	readonly reactComponentContainer: IReactComponentContainer;
}

/**
 * VariablesCore component.
 * @param props A VariablesCoreProps that contains the component properties.
 * @returns The rendered component.
 */
export const VariablesCore = (props: VariablesCoreProps) => {
	// Context hooks.
	const positronVariablesContext = usePositronVariablesContext();
	const progressRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const disposables = new DisposableStore();

		let progressBar: ProgressBar | undefined;
		let debounceTimeout: Timeout | undefined;

		const clearProgressBar = () => {
			if (debounceTimeout) {
				clearTimeout(debounceTimeout);
				debounceTimeout = undefined;
			}

			if (progressBar) {
				progressBar.done();
				progressBar.dispose();
				progressBar = undefined;
				progressRef.current?.replaceChildren();
			}
		}

		const setProgressBar = (timeout: number) => {
			// If there's a progress bar already scheduled to appear we'll clean it up,
			// and schedule a new one.
			if (debounceTimeout) {
				clearTimeout(debounceTimeout);
				debounceTimeout = undefined;
			}

			debounceTimeout = setTimeout(() => {
				// No work to do if we don't have a progress bar.
				if (!progressRef.current) {
					return;
				}
				// Before starting a new render, remove any existing progress bars. This prevents
				// a buildup of progress bars when rendering multiple times and ensures the progress bar
				// is removed when a new render is requested before the previous one completes.
				progressRef.current.replaceChildren();
				// Create the progress bar.
				progressBar = new ProgressBar(progressRef.current);
				progressBar.infinite();
			}, timeout)
		}

		if (positronVariablesContext.activePositronVariablesInstance) {
			disposables.add(positronVariablesContext.activePositronVariablesInstance.onDidChangeStatus((status) => {
				if (status === RuntimeClientStatus.Busy) {
					setProgressBar(500);
				} else {
					clearProgressBar();
				}
			}));

			if (positronVariablesContext.activePositronVariablesInstance.status === RuntimeClientStatus.Busy) {
				setProgressBar(100);
			}
		}

		return () => {
			clearProgressBar();
			disposables.dispose()
		};
	}, [positronVariablesContext.activePositronVariablesInstance])

	// If there are no instances, render nothing.
	// TODO@softwarenerd - Render something specific for this case. TBD.
	if (!positronVariablesContext.positronVariablesInstances.length) {
		return null;
	}

	// Calculate the adjusted height (the height minus the action bars height).
	const adjustedHeight = props.height - 64;

	// Render.
	return (
		<div className='variables-core'>
			<div ref={progressRef} id='variables-progress' />
			<ActionBars />
			<div className='variables-instances-container' style={{ width: props.width, height: adjustedHeight }}>
				{positronVariablesContext.positronVariablesInstances.map(positronVariablesInstance =>
					<VariablesInstance
						key={positronVariablesInstance.session.sessionId}
						active={positronVariablesInstance === positronVariablesContext.activePositronVariablesInstance}
						height={adjustedHeight}
						positronVariablesInstance={positronVariablesInstance}
						reactComponentContainer={props.reactComponentContainer}
						width={props.width} />
				)}
			</div>
		</div>
	);
};
