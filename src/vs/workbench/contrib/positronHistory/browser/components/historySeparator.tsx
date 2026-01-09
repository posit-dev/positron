/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { CSSProperties } from 'react';
import './historySeparator.css';

/**
 * Props for the HistorySeparator component
 */
interface HistorySeparatorProps {
	label: string;
	className?: string;
	style: CSSProperties;
	onClick?: () => void;
}

/**
 * HistorySeparator component - renders a sticky section header for history groups
 */
export const HistorySeparator = (props: HistorySeparatorProps) => {
	const { label, style, onClick } = props;

	// Use the style from react-window as-is (no sticky positioning)
	const customStyle: CSSProperties = style;

	return (
		<div
			className={props.className || 'history-separator'}
			style={customStyle}
			onClick={onClick}
		>
			<div className="history-separator-content">
				<span className="history-separator-label">{label}</span>
			</div>
		</div>
	);
};
