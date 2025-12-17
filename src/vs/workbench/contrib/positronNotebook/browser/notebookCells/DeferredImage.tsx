/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './DeferredImage.css';

// React.
import React from 'react';

// Other dependencies.
import { useNotebookInstance } from '../NotebookInstanceProvider.js';
import { URI } from '../../../../../base/common/uri.js';
import { Schemas } from '../../../../../base/common/network.js';
import { dirname } from '../../../../../base/common/resources.js';
import { localize } from '../../../../../nls.js';
import { createCancelablePromise, raceTimeout } from '../../../../../base/common/async.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';

/**
 * This should match the error message defined in the command definition
 * (extensions/positron-notebooks/src/extension.ts)
 */
type ConversionErrorMsg = {
	status: 'error';
	message: string;
};

/**
 * Predicate function to allow us to be safe with our response processing from command.
 * @param x: Variable of unknown type to check if it is a `ConversionErrorMsg`.
 * @returns Whether the object is a `ConversionErrorMsg`.
 */
function isConversionErrorMsg(x: unknown): x is ConversionErrorMsg {
	return x !== null && typeof x === 'object' && 'status' in x && x.status === 'error' && 'message' in x;
}

type ImageDataResults = {
	status: 'pending';
} | {
	status: 'success';
	data: string;
} | {
	status: 'error';
	message: string;
};

const REMOTE_SVG_TIMEOUT_MS = 5000;
const CONVERSION_TIMEOUT_MS = 3000;
const ERROR_TIMEOUT_MS = 1000;

/**
 * Special image component that defers loading of the image while it converts it to a data-url using
 * using a command from the `positronNotebookHelpers` extension.
 * @param props: Props for `img` element.
 * @returns Image tag that shows the image once it is loaded.
 */
export function DeferredImage({ src = 'no-source', ...props }: React.ComponentPropsWithoutRef<'img'>) {
	const services = usePositronReactServicesContext();
	const notebookInstance = useNotebookInstance();

	const [results, setResults] = React.useState<ImageDataResults>({ status: 'pending' });

	React.useEffect(() => {
		/**
		 * Shared helper to handle image conversion.
		 *
		 * @param commandName The command to execute
		 * @param commandArgs Arguments to pass to the command
		 * @param timeoutMs Timeout in milliseconds for the operation
		 * @returns A cleanup function to cancel ongoing operations
		 */
		const handleImageConversion = (
			commandName: string,
			commandArgs: unknown[],
			timeoutMs: number
		): (() => void) => {
			let delayedErrorMsg: Timeout;

			// Create cancelable promise to execute the command with timeout
			const conversionCancellablePromise = createCancelablePromise(() => raceTimeout(
				services.commandService.executeCommand(commandName, ...commandArgs),
				timeoutMs
			));

			// Handle the conversion result
			conversionCancellablePromise.then((payload) => {
				if (typeof payload === 'string') {
					// Success: got base64 data URL
					setResults({ status: 'success', data: payload });
				} else if (isConversionErrorMsg(payload)) {
					// Known error from the command
					delayedErrorMsg = setTimeout(() => {
						services.logService.error(
							localize('notebook.remoteImage.failedToConvert', "{0} - Failed to convert:", commandName),
							commandArgs[0], // image source
							payload.message
						);
					}, ERROR_TIMEOUT_MS);
					setResults(payload);
				} else {
					// Unexpected response format
					const unexpectedResponseString = localize('unexpectedResponse', "Unexpected response from {0}", commandName);
					delayedErrorMsg = setTimeout(() => {
						services.logService.error(unexpectedResponseString, payload);
					}, ERROR_TIMEOUT_MS);
					setResults({ status: 'error', message: unexpectedResponseString });
				}
			}).catch((err) => {
				// Promise was rejected (timeout or other error)
				setResults({ status: 'error', message: err.message });
			});

			// Return cleanup function for React effect
			return () => {
				clearTimeout(delayedErrorMsg);
				conversionCancellablePromise.cancel();
			};
		};

		/**
		 * Handles fetching and converting remote SVG images to base64 data URLs.
		 *
		 * @param imageUrl The SVG URL to fetch
		 * @returns Cleanup function to cancel ongoing operations
		 */
		const handleRemoteSvg = (imageUrl: string): (() => void) => {
			return handleImageConversion(
				'positronNotebookHelpers.fetchRemoteImage',
				[imageUrl],
				REMOTE_SVG_TIMEOUT_MS
			);
		};

		/**
		 * Handles converting local/relative image paths to base64 data URLs.
		 *
		 * @param imagePath The relative image path
		 * @param baseLocation The base directory to resolve relative paths from
		 * @returns Cleanup function to cancel ongoing operations
		 */
		const handleLocalImage = (imagePath: string, baseLocation: string): (() => void) => {
			return handleImageConversion(
				'positronNotebookHelpers.convertImageToBase64',
				[imagePath, baseLocation],
				CONVERSION_TIMEOUT_MS
			);
		};

		/* ---- Main useEffect logic starts here ---- */

		// Check for remote images (http/https URLs)
		if (src.startsWith('http://') || src.startsWith('https://')) {
			/**
			 * Remote SVGs are blocked by VS Code's security policy when loaded directly
			 * in the main window context (see `src/vs/code/electron-main/app.ts:221-303`).
			 * We safely handle SVGs by fetching the svg via the extension host and
			 * converting to base64 data URLs.
			 *
			 * Other formats (PNG, JPG, etc.) work natively and can be loaded directly.
			 */
			const isSvg = isSvgUrl(src);
			if (isSvg) {
				// Handle remote SVG through extension
				return handleRemoteSvg(src);
			} else {
				// Non-SVG remote images (PNG, JPG, etc.) work natively, use direct URL
				setResults({ status: 'success', data: src });
				return;
			}
		}

		// Otherwise, handle local/relative image paths
		let baseLocation: string;
		try {
			// Get base location to resolve relative paths
			baseLocation = getNotebookBaseUri(notebookInstance.uri).path;
		} catch (error) {
			setResults({ status: 'error', message: String(error) });
			return;
		}

		// Convert local image to base64 data URL
		return handleLocalImage(src, baseLocation);
	}, [src, notebookInstance, services]);

	switch (results.status) {
		case 'pending':
			return <div
				aria-label={(() => localize('deferredImageLoading', 'Loading image...'))()}
				className='positron-notebooks-deferred-img-placeholder'
				role='img'
				{...props}
			></div>;
		case 'error':
			// Show image tag without attempt to convert. Probably will be broken but will provide
			// clue as to what's going on.
			return <img {...props} aria-label={results.message} />;
		case 'success':
			return <img src={results.data} {...props} />;
	}
}

/**
 * Detects if a URL points to an SVG file based on its path extension.
 *
 * @param url The URL to check
 * @returns true if the URL path ends with .svg extension
 */
function isSvgUrl(url: string): boolean {
	try {
		const urlObj = new URL(url);
		// Get the pathname without query params or fragments
		const pathname = urlObj.pathname.toLowerCase();
		// Check if it ends with .svg
		return pathname.endsWith('.svg');
	} catch {
		// If URL parsing fails, fall back to simple check
		return url.toLowerCase().endsWith('.svg');
	}
}

function getNotebookBaseUri(notebookUri: URI) {
	if (notebookUri.scheme === Schemas.untitled) {
		// TODO: Use workspace context service to set the base URI to workspace root
		throw new Error('Have not yet implemented untitled notebook URIs');
	}

	return dirname(notebookUri);
}
