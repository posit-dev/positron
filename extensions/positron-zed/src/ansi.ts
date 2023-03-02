/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
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
	DoublyUnderlined = 21,
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
	ForegroundGray = 90,
	BrightForegroundBlack = 90,
	BrightForegroundRed = 91,
	BrightForegroundGreen = 92,
	BrightForegroundYellow = 93,
	BrightForegroundBlue = 94,
	BrightForegroundMagenta = 95,
	BrightForegroundCyan = 96,
	BrightForegroundWhite = 97,
	// 98 unsupported
	// 99 unsupported
	BackgroundGray = 100,
	BrightBackgroundBlack = 100,
	BrightBackgroundRed = 101,
	BrightBackgroundGreen = 102,
	BrightBackgroundYellow = 103,
	BrightBackgroundBlue = 104,
	BrightBackgroundMagenta = 105,
	BrightBackgroundCyan = 106,
	BrightBackgroundWhite = 107
}

/**
 * Makes an SGR (Select Graphic Rendition) escape sequence.
 * @param parameters The SGR parameters.
 * @returns The SGR escape sequence.
 */
export const MakeSGR = (...parameters: SGR[]): string => {
	return CSI + parameters.map(parameter => `${parameter}`).join(';') + 'm';
};
