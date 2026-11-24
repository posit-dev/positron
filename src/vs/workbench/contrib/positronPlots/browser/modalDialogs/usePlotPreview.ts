/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useRef, useState } from 'react';
import { IPlotSize } from '../../../../services/positronPlots/common/sizingPolicy.js';
import { PlotClientInstance } from '../../../../services/languageRuntime/common/languageRuntimePlotClient.js';
import { IOneTimeRender, IRenderedPlot } from '../../../../services/languageRuntime/common/positronPlotRenderQueue.js';
import { PlotPreviewStatus } from './plotSizeEditor.js';

interface IPendingPreview {
	size: IPlotSize;
	render: IOneTimeRender;
}

/**
 * Draws the plot at requested sizes for the size dialog's preview. Only the latest
 * request is kept: a new request cancels the one before it.
 */
export function usePlotPreview(plotClient: PlotClientInstance, pixelRatio: number) {
	const [preview, setPreview] = useState<IRenderedPlot | undefined>();
	const [status, setStatus] = useState<PlotPreviewStatus>('idle');
	const [pending, setPending] = useState<IPendingPreview | undefined>();

	// Refs mirror the state so request() and the async work see current values.
	const previewRef = useRef<IRenderedPlot | undefined>(undefined);
	const pendingRef = useRef<IPendingPreview | undefined>(undefined);
	const closedRef = useRef(false);

	const setPendingBoth = (value: IPendingPreview | undefined) => {
		pendingRef.current = value;
		setPending(value);
	};

	const cancelPending = useCallback(() => {
		pendingRef.current?.render.cancel();
		pendingRef.current = undefined;
	}, []);

	useEffect(() => {
		closedRef.current = false;
		const disposable = plotClient.onDidClose(() => {
			closedRef.current = true;
			cancelPending();
			setPending(undefined);
			setStatus('unavailable');
		});
		return () => {
			disposable.dispose();
			cancelPending();
		};
	}, [plotClient, cancelPending]);

	const request = useCallback((size: IPlotSize) => {
		if (closedRef.current) {
			return;
		}
		const current = pendingRef.current?.size ?? previewRef.current?.size;
		if (current && current.width === size.width && current.height === size.height) {
			return;
		}
		cancelPending();

		const render = plotClient.renderOnce(size, pixelRatio);
		const entry: IPendingPreview = { size, render };
		setPendingBoth(entry);
		setStatus('waiting');

		const run = async () => {
			try {
				// `started` never resolves for a cancelled render, so race it with `promise`.
				await Promise.race([render.started, render.promise]);
				if (pendingRef.current === entry) {
					setStatus('drawing');
				}
				const result = await render.promise;
				if (pendingRef.current !== entry) {
					return;
				}
				previewRef.current = result;
				setPreview(result);
				setPendingBoth(undefined);
				setStatus('idle');
			} catch {
				// Cancelled (replaced or closed) renders are ignored. A failed render keeps the last preview.
				if (pendingRef.current === entry) {
					setPendingBoth(undefined);
					setStatus('idle');
				}
			}
		};
		void run();
	}, [plotClient, pixelRatio, cancelPending]);

	return { preview, status, pending, request };
}
