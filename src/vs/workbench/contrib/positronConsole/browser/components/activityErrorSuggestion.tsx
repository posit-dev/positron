/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './activityErrorSuggestion.css';

// React.
import { useState } from 'react';

// Other dependencies.
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';
import { ActivityItemErrorSuggestion } from '../../../../services/positronConsole/browser/classes/activityItemErrorSuggestion.js';

// ActivityErrorSuggestionProps interface.
export interface ActivityErrorSuggestionProps {
	activityItemErrorSuggestion: ActivityItemErrorSuggestion;
}

/**
 * ActivityErrorSuggestion component. Renders one or more follow-up actions (e.g.
 * "Install <pkg>") beneath a console error, with a yellow gutter and a lightbulb.
 * @param props An ActivityErrorSuggestionProps that contains the component properties.
 * @returns The rendered component.
 */
export const ActivityErrorSuggestion = (props: ActivityErrorSuggestionProps) => {
	// Track which suggestion is currently running so its link disables while it works.
	const [runningIndex, setRunningIndex] = useState<number | undefined>(undefined);

	const pressedHandler = async (index: number) => {
		if (runningIndex !== undefined) {
			return;
		}
		setRunningIndex(index);
		try {
			await props.activityItemErrorSuggestion.suggestions[index].run();
		} finally {
			setRunningIndex(undefined);
		}
	};

	// Render.
	return (
		<div className='activity-error-suggestion'>
			<div className='suggestion-bar' data-testid='error-suggestion-bar'></div>
			<div className='suggestion-information'>
				{props.activityItemErrorSuggestion.suggestions.map((suggestion, index) => (
					<Button
						key={index}
						className='suggestion-action'
						disabled={runningIndex !== undefined}
						onPressed={() => pressedHandler(index)}
					>
						<div className={`suggestion-icon ${ThemeIcon.asClassName(suggestion.icon)}`}></div>
						<div className='link-text'>{suggestion.label}</div>
					</Button>
				))}
			</div>
		</div>
	);
};
