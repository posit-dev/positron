/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Constants.
 */
const ESC = '\x1b';
const CSI = ESC + '[';

export enum SGR {
	Reset = 0,
	Bold = 1,
	Dim = 2,
	Italic = 3,
	Underlined = 4,
	SlowBlink = 5,
	RapidBlink = 6,
	Reversed = 7,
	Hidden = 8,
	CrossedOut = 9,
	PrimaryFont = 10,
	AlternativeFont1 = 11,
	AlternativeFont2 = 12,
	AlternativeFont3 = 13,
	AlternativeFont4 = 14,
	AlternativeFont5 = 15,
	AlternativeFont6 = 16,
	AlternativeFont7 = 17,
	AlternativeFont8 = 18,
	AlternativeFont9 = 19,
	Fraktur = 20,
	DoubleUnderlined = 21,
	NormalIntensity = 22,
	NotItalicNotFraktur = 23,
	NotUnderlined = 24,
	NotBlinking = 25,
	ProportionalSpacing = 26,
	NotReversed = 27,
	Reveal = 28,
	NotCrossedOut = 29,
	ForegroundBlack = 30,
	ForegroundRed = 31,
	ForegroundGreen = 32,
	ForegroundYellow = 33,
	ForegroundBlue = 34,
	ForegroundMagenta = 35,
	ForegroundCyan = 36,
	ForegroundWhite = 37,
	SetForeground = 38,
	DefaultForeground = 39,
	BackgroundBlack = 40,
	BackgroundRed = 41,
	BackgroundGreen = 42,
	BackgroundYellow = 43,
	BackgroundBlue = 44,
	BackgroundMagenta = 45,
	BackgroundCyan = 46,
	BackgroundWhite = 47,
	SetBackground = 48,
	DefaultBackground = 49,
	DisableProportionalSpacing = 50,
	Framed = 51,
	Encircled = 52,
	Overlined = 53,
	NotFramedNotEncircled = 54,
	NotOverlined = 55,
	// 56 unsupported
	// 57 unsupported
	SetUnderline = 58,
	DefaultUnderline = 59,
	IdeogramUnderlineOrRightSideLine = 60,
	IdeogramDoubleUnderlineOrDoubleRightSideLine = 61,
	IdeogramOverlineOrLeftSideLine = 62,
	IdeogramDoubleOverlineOrDoubleLeftSideLine = 63,
	IdeogramStressMarking = 64,
	NoIdeogramAttributes = 65,
	// 66 unsupported
	// 67 unsupported
	// 68 unsupported
	// 69 unsupported
	// 70 unsupported
	// 71 unsupported
	// 72 unsupported
	Superscript = 73,
	Subscript = 74,
	NotSuperscriptNotSubscript = 75,
	// 76 unsupported
	// 77 unsupported
	// 78 unsupported
	// 79 unsupported
	// 80 unsupported
	// 81 unsupported
	// 82 unsupported
	// 83 unsupported
	// 84 unsupported
	// 85 unsupported
	// 86 unsupported
	// 87 unsupported
	// 88 unsupported
	// 89 unsupported
	ForegroundBrightBlack = 90,
	ForegroundBrightRed = 91,
	ForegroundBrightGreen = 92,
	ForegroundBrightYellow = 93,
	ForegroundBrightBlue = 94,
	ForegroundBrightMagenta = 95,
	ForegroundBrightCyan = 96,
	ForegroundBrightWhite = 97,
	// 98 unsupported
	// 99 unsupported
	BackgroundBrightBlack = 100,
	BackgroundBrightRed = 101,
	BackgroundBrightGreen = 102,
	BackgroundBrightYellow = 103,
	BackgroundBrightBlue = 104,
	BackgroundBrightMagenta = 105,
	BackgroundBrightCyan = 106,
	BackgroundBrightWhite = 107
}

/**
 * Makes a CUF (Cursor Forward) escape sequence.
 * @param count The count.
 * @returns The CUF escape sequence.
 */
export const makeCUF = (count: number = 1) => {
	if (count === 1) {
		return `${CSI}C`;
	} else {
		return `${CSI}${count}C`;
	}
};

/**
 * Makes a CUB (Cursor Backward) escape sequence.
 * @param count The count.
 * @returns The CUB escape sequence.
 */
export const makeCUB = (count: number = 1) => {
	if (count === 1) {
		return `${CSI}D`;
	} else {
		return `${CSI}${count}D`;
	}
};

/**
 * Makes a CUP (Cursor Position) escape sequence.
 * @param line The line.
 * @param column The column.
 * @returns The CUP escape sequence.
 */
export const makeCUP = (line: number | undefined = undefined, column: number | undefined = undefined) => {
	if (!line && !column) {
		return `${CSI}H`;
	} else if (line && !column) {
		return `${CSI}${line}H`;
	} else if (!line && column) {
		return `${CSI};${column}H`;
	} else {
		return `${CSI}${line};${column}H`;
	}
};

/**
 * Makes an ED (Erase in Display) escape sequence.
 * @param count The count.
 * @returns The CUB escape sequence.
 */
export const makeED = (direction: 'end-of-screen' | 'beginning-of-screen' | 'entire-screen' = 'end-of-screen') => {
	switch (direction) {
		case 'end-of-screen':
			return `${CSI}J`;

		case 'beginning-of-screen':
			return `${CSI}1J`;

		case 'entire-screen':
			return `${CSI}2J`;
	}
};

/**
 * Makes an EL (Erase in Line) escape sequence.
 * @param count The count.
 * @returns The EL escape sequence.
 */
export const makeEL = (direction: 'end-of-line' | 'beginning-of-line' | 'entire-line' = 'end-of-line') => {
	switch (direction) {
		case 'end-of-line':
			return `${CSI}K`;

		case 'beginning-of-line':
			return `${CSI}1K`;

		case 'entire-line':
			return `${CSI}2K`;
	}
};

/**
 * Makes an SGR (Select Graphic Rendition) escape sequence.
 * @param parameters The SGR parameters.
 * @returns The SGR escape sequence.
 */
export const makeSGR = (...parameters: number[]): string => {
	return CSI + parameters.map(parameter => `${parameter}`).join(';') + 'm';
};
