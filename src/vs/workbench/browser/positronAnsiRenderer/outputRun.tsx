/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './outputRun.css';

// React.
import React, { CSSProperties, MouseEvent } from 'react';

// Other dependencies.
import { localize } from '../../../nls.js';
import { Schemas } from '../../../base/common/network.js';
import * as platform from '../../../base/common/platform.js';
import { IOpenerService } from '../../../platform/opener/common/opener.js';
import { ANSIColor, ANSIOutputRun, ANSIStyle } from '../../../base/common/ansiOutput.js';
import { INotificationService } from '../../../platform/notification/common/notification.js';
import { OutputRunWithLinks } from '../../contrib/positronConsole/browser/components/outputRunWithLinks.js';

/**
 * Constants.
 */
const numberRegex = /^\d+$/;
const fileURLThatNeedsASlash = /^(file:\/\/)([a-zA-Z]:)/;
const fileURLWithLine = /^(file:\/\/\/.+):(\d+)$/;
const fileURLWithLineAndColumn = /^(file:\/\/\/.+):(\d+):(\d+)$/;

// OutputRunProps interface.
export interface OutputRunProps {
	readonly openerService: IOpenerService;
	readonly notificationService: INotificationService;
	readonly outputRun: ANSIOutputRun;
}

/**
 * ColorType enumeration.
 */
enum ColorType {
	Foreground,
	Background
}

/**
 * OutputRun component.
 * @param props A OutputRunProps that contains the component properties.
 * @returns The rendered component.
 */
export const OutputRun = (props: OutputRunProps) => {
	/**
	 * Builds the hyperlink URL for the output run.
	 * @returns The hyperlink URL for the output run. Returns undefined if the output run's
	 * hyperlink is undefined.
	 */
	const buildHyperlinkURL = () => {
		// If the hyperlink is undefined, return undefined.
		if (!props.outputRun.hyperlink) {
			return undefined;
		}

		// Get the URL. If it's not a file URL, return it.
		let url = props.outputRun.hyperlink.url;
		if (!url.startsWith(`${Schemas.file}:`)) {
			return url;
		}

		// anticipate file URLs produced by, e.g., some versions of the cli R package
		// BEFORE example:
		// file://D:\\Users\\jenny\\source\\repos\\glue\\tests\\testthat\\test-glue.R
		// AFTER example:
		// file:///D:/Users/jenny/source/repos/glue/tests/testthat/test-glue.R
		if (platform.isWindows) {
			url = url
				.replace(/\\/g, '/')
				.replace(fileURLThatNeedsASlash, '$1/$2');
		}

		// Get the line parameter. If it's not present, return the URL.
		const line = props.outputRun.hyperlink.params?.get('line') || undefined;
		if (!line) {
			// See if the URL has line / column information in :line:col format.
			{
				const match = url.match(fileURLWithLineAndColumn);
				if (match && match.length === 4) {
					return `${match[1]}#${match[2]},${match[3]}`;
				}
			}

			// See if the URL has line information in :line format.
			{
				const match = url.match(fileURLWithLine);
				if (match && match.length === 3) {
					return `${match[1]}#${match[2]},1`;
				}
			}

			// Just return the URL without line / column information.
			return url;
		}
		const lineMatch = line.match(numberRegex);
		if (!lineMatch) {
			return url;
		}

		// Append the line number to the URL.
		url += `#${lineMatch[0]}`;

		// Get the column parameter. If it's not present, return the URL.
		const col = props.outputRun.hyperlink.params?.get('col') || undefined;
		if (!col) {
			return url;
		}
		const colMatch = col.match(numberRegex);
		if (!colMatch) {
			return url;
		}

		// Append the column number to the URL.
		url += `,${colMatch[0]}`;

		// Return the URL.
		return url;
	};

	/**
	 * Hyperlink click handler.
	 * @param e A MouseEvent<HTMLElement> that describes a user interaction with the mouse.
	 */
	const hyperlinkClickHandler = (e: MouseEvent<HTMLElement>) => {
		// Consume the event.
		e.preventDefault();
		e.stopPropagation();

		// Build the hyperlink URL. If there is one, open it.
		const url = buildHyperlinkURL();
		if (url) {
			props.openerService.open(url);
		} else {
			// Can't happen.
			props.notificationService.error(localize(
				'positron.unableToOpenHyperlink',
				"The hyperlink could not be opened."
			));
		}
	};

	/**
	 * Computes the styles.
	 * @param styles The ANSIStyle array to compute.
	 * @returns A CSSProperties that represents the styles.
	 */
	const computeStyles = (styles?: ANSIStyle[]): CSSProperties => {
		// Compute CSS properties from the styles.
		let cssProperties: CSSProperties = {};
		if (styles) {
			styles.forEach(style => {
				switch (style) {
					// Bold.
					case ANSIStyle.Bold: {
						cssProperties = {
							...cssProperties,
							...{
								fontWeight: 'bold'
							}
						};
						break;
					}

					// Dim.
					case ANSIStyle.Dim: {
						cssProperties = {
							...cssProperties,
							...{
								fontWeight: 'lighter'
							}
						};
						break;
					}

					// Italic.
					case ANSIStyle.Italic: {
						cssProperties = {
							...cssProperties,
							...{
								fontStyle: 'italic'
							}
						};
						break;
					}

					// Underlined.
					case ANSIStyle.Underlined: {
						cssProperties = {
							...cssProperties,
							...{
								textDecorationLine: 'underline',
								textDecorationStyle: 'solid'
							}
						};
						break;
					}

					// Slow blink.
					case ANSIStyle.SlowBlink: {
						cssProperties = {
							...cssProperties,
							...{
								animation: 'positronOutputRun-blink 1s linear infinite'
							}
						};
						break;
					}

					// Rapid blink.
					case ANSIStyle.RapidBlink: {
						cssProperties = {
							...cssProperties,
							...{
								animation: 'positronOutputRun-blink 0.5s linear infinite'
							}
						};
						break;
					}

					// Hidden.
					case ANSIStyle.Hidden: {
						cssProperties = {
							...cssProperties,
							...{
								visibility: 'hidden'
							}
						};
						break;
					}

					// CrossedOut.
					case ANSIStyle.CrossedOut: {
						cssProperties = {
							...cssProperties,
							...{
								textDecorationLine: 'line-through',
								textDecorationStyle: 'solid'
							}
						};
						break;
					}

					// TODO Fraktur

					// DoubleUnderlined.
					case ANSIStyle.DoubleUnderlined: {
						cssProperties = {
							...cssProperties,
							...{
								textDecorationLine: 'underline',
								textDecorationStyle: 'double'
							}
						};
						break;
					}

					// TODO Framed
					// TODO Encircled
					// TODO Overlined
					// TODO Superscript
					// TODO Subscript
				}
			});
		}

		// Return the CSS properties.
		return cssProperties;
	};

	/**
	 * Computes the foreground or background color.
	 * @param colorType The color type (foreground or background).
	 * @param color The color. This can be one of the standard ANSI colors from the ANSIColor
	 * enumeration or a string with an RGB color.
	 * @returns A CSSProperties that represents the foreground or background color.
	 */
	const computeForegroundBackgroundColor = (
		colorType: ColorType,
		color?: ANSIColor | string
	): CSSProperties => {
		switch (color) {
			// Undefined.
			case undefined: {
				return {};
			}

			// One of the standard colors.
			case ANSIColor.Black:
			case ANSIColor.Red:
			case ANSIColor.Green:
			case ANSIColor.Yellow:
			case ANSIColor.Blue:
			case ANSIColor.Magenta:
			case ANSIColor.Cyan:
			case ANSIColor.White:
			case ANSIColor.BrightBlack:
			case ANSIColor.BrightRed:
			case ANSIColor.BrightGreen:
			case ANSIColor.BrightYellow:
			case ANSIColor.BrightBlue:
			case ANSIColor.BrightMagenta:
			case ANSIColor.BrightCyan:
			case ANSIColor.BrightWhite: {
				if (colorType === ColorType.Foreground) {
					return { color: `var(--vscode-positronConsole-${color})` };
				} else {
					return { background: `var(--vscode-positronConsole-${color})` };
				}
			}

			// TODO@softwarenerd - This isn't hooked up.
			default: {
				if (colorType === ColorType.Foreground) {
					return { color: color };
				} else {
					return { background: color };
				}
			}
		}
	};

	// Computes the CSS properties for an output run.
	const computeCSSProperties = (outputRun: ANSIOutputRun): CSSProperties => {
		return !outputRun.format ?
			{} :
			{
				...computeStyles(outputRun.format.styles),
				...computeForegroundBackgroundColor(
					ColorType.Foreground,
					outputRun.format.foregroundColor
				),
				...computeForegroundBackgroundColor(
					ColorType.Background,
					outputRun.format.backgroundColor
				),
			};
	};

	// Render.
	if (!props.outputRun.hyperlink) {
		// No OSC 8 hyperlink. Do a cheap scan for http.
		if (props.outputRun.text.indexOf('http') === -1) {
			// There's no link in this text; we can render it directly.
			return (
				<span className='output-run' style={computeCSSProperties(props.outputRun)}>
					{props.outputRun.text}
				</span>
			);
		} else {
			// Use a component that scans for hyperlink(s). This is a little
			// more expensive (currently uses a regex), so we only do it if the
			// text contains http.
			return (
				<span className='output-run' style={computeCSSProperties(props.outputRun)}>
					<OutputRunWithLinks text={props.outputRun.text} />
				</span>
			);
		}
	} else {
		return (
			<a className='output-run-hyperlink' href='#' onClick={hyperlinkClickHandler}>
				<span className='output-run' style={computeCSSProperties(props.outputRun)}>
					{props.outputRun.text}
				</span>
			</a>
		);
	}
};
