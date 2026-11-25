/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useRef, useState } from 'react';
import { isCancellationError } from '../../../../../base/common/errors.js';
import { IPlotSize } from '../../../../services/positronPlots/common/sizingPolicy.js';
import { PlotClientInstance } from '../../../../services/languageRuntime/common/languageRuntimePlotClient.js';
import { IOneTimeRender, IRenderedPlot } from '../../../../services/languageRuntime/common/positronPlotRenderQueue.js';
import { PlotPreviewStatus } from './plotSizeEditor.js';

export interface IPendingPreview {
	size: IPlotSize;
	pixelRatio: number;
	render: IOneTimeRender;
}

export interface IPlotPreview {
	preview?: IRenderedPlot;
	status: PlotPreviewStatus;
	/** Whether the last draw failed; stays set while the next one runs, until one succeeds. */
	failed: boolean;
	pending?: IPendingPreview;
	request: (size: IPlotSize) => void;
}

/**
 * Draws the plot at requested sizes for the size dialog's preview. Only the latest
 * request is kept: a new request cancels the one before it.
 */
export function usePlotPreview(plotClient: PlotClientInstance, pixelRatio: number): IPlotPreview {
	const [preview, setPreview] = useState<IRenderedPlot | undefined>();
	const [status, setStatus] = useState<PlotPreviewStatus>('idle');
	const [pending, setPending] = useState<IPendingPreview | undefined>();
	const [failed, setFailed] = useState(false);

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
		const same = (a: IPlotSize | undefined, ratio: number | undefined) =>
			!!a && a.width === size.width && a.height === size.height && ratio === pixelRatio;
		if (same(pendingRef.current?.size, pendingRef.current?.pixelRatio)) {
			return;
		}
		if (same(previewRef.current?.size, previewRef.current?.pixel_ratio)) {
			// The wanted size is already shown: drop any other pending draw or failure.
			if (pendingRef.current) {
				cancelPending();
				setPending(undefined);
			}
			setStatus('idle');
			setFailed(false);
			return;
		}
		cancelPending();

		const render = plotClient.renderOnce(size, pixelRatio);
		const entry: IPendingPreview = { size, pixelRatio, render };
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
				setFailed(false);
			} catch (error) {
				// A replaced or closed render is ignored. Another cancel (e.g. the console exited) is not a size failure.
				if (pendingRef.current === entry) {
					setPendingBoth(undefined);
					if (isCancellationError(error)) {
						setStatus('idle');
					} else {
						setStatus('failed');
						setFailed(true);
					}
				}
			}
		};
		void run();
	}, [plotClient, pixelRatio, cancelPending]);

	return { preview, status, failed, pending, request };
}
