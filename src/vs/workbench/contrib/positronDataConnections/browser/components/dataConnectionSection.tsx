/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './dataConnectionSection.css';

/**
 * A section header in the data connections list. Groups a run of rows under a labeled heading
 * (e.g. "Active Connections", "Saved"). The shape is intentionally minimal -- additional fields
 * (counts, badges, etc.) can be added when the UI needs them.
 */
export interface IDataConnectionSection {
	// The label shown in the section header.
	readonly label: string;
}

/**
 * DataConnectionSectionProps interface.
 */
interface DataConnectionSectionProps {
	section: IDataConnectionSection;
}

/**
 * DataConnectionSection component.
 */
export const DataConnectionSection = ({ section }: DataConnectionSectionProps) => (
	<div className='data-connection-section'>
		{section.label}
	</div>
);
