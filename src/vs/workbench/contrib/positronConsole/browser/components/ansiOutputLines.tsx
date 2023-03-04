/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./ansiOutputLines';
import * as React from 'react';
import { CSSProperties } from 'react'; // eslint-disable-line no-duplicate-imports
import { ANSIColor, ANSIOutputLine, ANSIOutputRun, ANSIStyle } from 'vs/base/common/ansi/ansiOutput';

// ANSIOutputLinesProps interface.
export interface ANSIOutputLinesProps {
	readonly outputLines: readonly ANSIOutputLine[];
}

/**
 * ANSIOutputLines component.
 * @param props A ANSIOutputLinesProps that contains the component properties.
 * @returns The rendered component.
 */
export const ANSIOutputLines = ({ outputLines }: ANSIOutputLinesProps) => {

	// readonly styles: ANSIStyle[];
	// readonly foregroundColor: ANSIColor | string | undefined;
	// readonly backgroundColor: ANSIColor | string | undefined;
	// readonly underlinedColor: string | undefined;
	// readonly font: string | undefined;
	// readonly text: string;

	/**
	 * ColorType enumeration.
	 */
	enum ColorType {
		Foreground,
		Background
	}

	/**
	 * Computes the styles.
	 * @param styles The styles to compute.
	 * @returns A CSSProperties that represents the styles.
	 */
	const computeStyles = (styles: ANSIStyle[]): CSSProperties => {
		// Compute CSS properties from the styles.
		let cssProperties: CSSProperties = {};
		styles.forEach(style => {
			switch (style) {
				// Bold.
				case ANSIStyle.Bold:
					cssProperties = { ...cssProperties, ...{ fontWeight: 'bold' } };
					break;

				// Dim.
				case ANSIStyle.Dim:
					cssProperties = { ...cssProperties, ...{ fontWeight: 'lighter' } };
					break;

				// Italic.
				case ANSIStyle.Italic:
					cssProperties = { ...cssProperties, ...{ fontStyle: 'italic' } };
					break;

				// Underlined.
				case ANSIStyle.Underlined:
					cssProperties = { ...cssProperties, ...{ textDecorationLine: 'underline', textDecorationStyle: 'solid' } };
					break;

				// TODO SlowBlink
				// TODO RepidBlink
				// TODO Hidden

				// CrossedOut.
				case ANSIStyle.CrossedOut:
					cssProperties = { ...cssProperties, ...{ textDecorationLine: 'line-through', textDecorationStyle: 'solid' } };
					break;

				// TODO Fraktur

				// DoubleUnderlined.
				case ANSIStyle.DoubleUnderlined:
					cssProperties = { ...cssProperties, ...{ textDecorationLine: 'underline', textDecorationStyle: 'double' } };
					break;

				// TODO Framed
				// TODO Encircled
				// TODO Overlined
				// TODO Superscript
				// TODO Subscript
			}
		});

		// Return the CSS properties.
		return cssProperties;
	};

	/**
	 * Computes the foreground or background color.
	 * @param colorType The color type (foreground or background).
	 * @param color The color. This can be one of the standard ANSI colors from
	 * the ANSIColor enumeration or
	 * @returns A CSSProperties that represents the foreground or background
	 * color.
	 */
	const computeForegroundBackgroundColor = (colorType: ColorType, color?: ANSIColor | string): CSSProperties => {
		switch (color) {
			// Undefined.
			case undefined:
				return {};

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
			case ANSIColor.BrightWhite:
				if (colorType === ColorType.Foreground) {
					return { color: `var(--vscode-positronConsole-${color})` };
				} else {
					return { background: `var(--vscode-positronConsole-${color})` };
				}

			// TODO@softwarenerd - This isn't hooked up.
			default:
				if (colorType === ColorType.Foreground) {
					return { color: color };
				} else {
					return { background: color };
				}
		}
	};

	// Computes the CSS properties for an output run.
	const computeCSSProperties = (outputRun: ANSIOutputRun): CSSProperties => {
		return {
			...computeStyles(outputRun.styles),
			...computeForegroundBackgroundColor(ColorType.Foreground, outputRun.foregroundColor),
			...computeForegroundBackgroundColor(ColorType.Background, outputRun.backgroundColor),
		};
	};

	// Render.
	return (
		<div className='ansi-output-lines'>
			{outputLines.map(outputLine =>
				<div key={outputLine.id} className='ansi-output-line'>
					{!outputLine.outputRuns.length ?
						<br /> :
						outputLine.outputRuns.map(outputRun => {
							return <span key={outputRun.id} style={computeCSSProperties(outputRun)}>{outputRun.text}</span>;
						})
					}
				</div>
			)}
		</div>
	);
};
