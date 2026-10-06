/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { useEffect, useState } from 'react';

// Other dependencies.
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { getInlineGridMetrics, IInlineGridMetrics } from './inlineGridMetrics.js';

/**
 * React hook that returns the inline grid layout metrics and updates them when
 * the editor font size or line height changes. The returned object keeps its
 * identity until a metric value actually changes, so callers can use it as an
 * effect dependency to rebuild the grid only when its layout must change.
 * @param configurationService The configuration service.
 * @returns The inline grid metrics for the current editor font.
 */
export function useInlineGridMetrics(configurationService: IConfigurationService): IInlineGridMetrics {
	const [metrics, setMetrics] = useState(() => getInlineGridMetrics(configurationService));
	useEffect(() => {
		const disposable = configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('editor.fontSize') || e.affectsConfiguration('editor.lineHeight')) {
				const next = getInlineGridMetrics(configurationService);
				setMetrics(prev => equalsInlineGridMetrics(prev, next) ? prev : next);
			}
		});
		return () => disposable.dispose();
	}, [configurationService]);
	return metrics;
}

function equalsInlineGridMetrics(a: IInlineGridMetrics, b: IInlineGridMetrics): boolean {
	return a.fontScale === b.fontScale &&
		a.columnHeadersHeight === b.columnHeadersHeight &&
		a.defaultRowHeight === b.defaultRowHeight &&
		a.rowHeadersWidth === b.rowHeadersWidth &&
		a.defaultColumnWidth === b.defaultColumnWidth &&
		a.horizontalCellPadding === b.horizontalCellPadding &&
		a.scrollbarThickness === b.scrollbarThickness;
}
