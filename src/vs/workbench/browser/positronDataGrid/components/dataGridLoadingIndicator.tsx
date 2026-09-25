/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './dataGridLoadingIndicator.css';

// Other dependencies.
import * as nls from '../../../../nls.js';

/**
 * Geometry of the ring, in the units of the 24-unit viewBox below. The radius is the stroke's
 * center line, so it is also where the dot sits.
 */
const RING_RADIUS = 7;
const RING_STROKE_WIDTH = 1.25;
const DOT_RADIUS = 2;

/**
 * The ring covers three quarters of the circle, leaving the quadrant clockwise of the dot open.
 * A dash and a gap in that proportion, in user units, because stroke-dasharray is measured along
 * the path rather than in degrees.
 */
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const RING_DASH_ARRAY = `${RING_CIRCUMFERENCE * 0.75} ${RING_CIRCUMFERENCE * 0.25}`;

/**
 * DataGridLoadingIndicator component. Shown in place of the grid while it does not yet know enough
 * to lay itself out, so that the wait reads as work in progress rather than as an empty grid.
 * @returns The rendered component.
 */
export const DataGridLoadingIndicator = () => {
	// Render. How long the wait will be isn't known -- it is however long the data source takes to
	// describe and sample the table -- so the indicator is indeterminate.
	//
	// This is the mark of status-active.svg, the Data Explorer's status bar activity indicator --
	// a three-quarter ring with a dot riding its leading edge, the ring's own quadrant left open
	// clockwise of the dot -- drawn from the same radii but with a lighter stroke and a smaller
	// dot, which carry better at this size than scaling the icon up does. Drawn rather than pointed
	// at that file because the file carries a fixed fill and lives in the Data Explorer, while this
	// is a data grid component that takes its color from the theme.
	//
	// A circle's path starts at three o'clock and runs clockwise, so the dash begins there and the
	// gap lands between twelve and three. The viewBox is the icon's own 24 units, untrimmed, which
	// puts the ring's center at the center of the element -- and so at the center of the rotation,
	// which is what keeps it from wobbling.
	return (
		<div className='data-grid-loading-indicator'>
			<svg
				aria-label={nls.localize('positronDataGrid.loadingData', "Loading data")}
				className='spinner'
				role='progressbar'
				viewBox='0 0 24 24'
			>
				<circle
					cx={12}
					cy={12}
					fill='none'
					r={RING_RADIUS}
					stroke='currentColor'
					strokeDasharray={RING_DASH_ARRAY}
					strokeWidth={RING_STROKE_WIDTH}
				/>
				<circle
					cx={12}
					cy={12 - RING_RADIUS}
					fill='currentColor'
					r={DOT_RADIUS}
				/>
			</svg>
		</div>
	);
};
