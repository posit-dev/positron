/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * SGRParam enumeration.
 */
export enum SGRParam {
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
 * ANSIStyle enumeration.
 */
export enum ANSIStyle {
	Bold = 'bold',
	Dim = 'dim',
	Italic = 'italic',
	Underlined = 'underlined',
	SlowBlink = 'slow-blink',
	RapidBlink = 'rapid-blink',
	// Reversed
	Hidden = 'hidden',
	CrossedOut = 'crossed-out',
	// PrimaryFont
	AlternativeFont1 = 'font-1',
	AlternativeFont2 = 'font-2',
	AlternativeFont3 = 'font-3',
	AlternativeFont4 = 'font-4',
	AlternativeFont5 = 'font-5',
	AlternativeFont6 = 'font-6',
	AlternativeFont7 = 'font-7',
	AlternativeFont8 = 'font-8',
	AlternativeFont9 = 'font-9',
	Fraktur = 'fraktur',
	DoubleUnderlined = 'double-underlined',
	// NormalIntensity
	// NotItalicNotFraktur
	// NotUnderlined
	// NotBlinking
	// ProportionalSpacing
	// NotReversed
	// Reveal
	// NotCrossedOut
	ForegroundBlack = 'foreground-black',
	ForegroundRed = 'foreground-red',
	ForegroundGreen = 'foreground-green',
	ForegroundYellow = 'foreground-yellow',
	ForegroundBlue = 'foreground-blue',
	ForegroundMagenta = 'foreground-magenta',
	ForegroundCyan = 'foreground-cyan',
	ForegroundWhite = 'foreground-white',
	// SetForeground
	// DefaultForeground
	BackgroundBlack = 'background-black',
	BackgroundRed = 'background-red',
	BackgroundGreen = 'background-green',
	BackgroundYellow = 'background-yellow',
	BackgroundBlue = 'background-blue',
	BackgroundMagenta = 'background-magenta',
	BackgroundCyan = 'background-cyan',
	BackgroundWhite = 'background-white',
	// SetBackground
	// DefaultBackground
	// DisableProportionalSpacing
	// Framed
	// Encircled
	// Overlined
	// NotFramedNotEncircled
	// NotOverlined
	// 56 unsupported
	// 57 unsupported
	// SetUnderline
	// DefaultUnderline
	// IdeogramUnderlineOrRightSideLine
	// IdeogramDoubleUnderlineOrDoubleRightSideLine
	// IdeogramOverlineOrLeftSideLine
	// IdeogramDoubleOverlineOrDoubleLeftSideLine
	// IdeogramStressMarking
	// NoIdeogramAttributes
	// 66 unsupported
	// 67 unsupported
	// 68 unsupported
	// 69 unsupported
	// 70 unsupported
	// 71 unsupported
	// 72 unsupported
	Superscript = 'superscript',
	Subscript = 'subscript',
	// NotSuperscriptNotSubscript
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
	ForegroundBrightBlack = 'foreground-bright-black',
	ForegroundBrightRed = 'foreground-bright-red',
	ForegroundBrightGreen = 'foreground-bright-green',
	ForegroundBrightYellow = 'foreground-bright-yellow',
	ForegroundBrightBlue = 'foreground-bright-blue',
	ForegroundBrightMagenta = 'foreground-bright-magenta',
	ForegroundBrightCyan = 'foreground-bright-cyan',
	ForegroundBrightWhite = 'foreground-bright-white',
	// 98 unsupported
	// 99 unsupported
	BackgroundBrightBlack = 'background-bright-black',
	BackgroundBrightRed = 'background-bright-red',
	BackgroundBrightGreen = 'background-bright-green',
	BackgroundBrightYellow = 'background-bright-yellow',
	BackgroundBrightBlue = 'background-bright-blue',
	BackgroundBrightMagenta = 'background-bright-magenta',
	BackgroundBrightCyan = 'background-bright-cyan',
	BackgroundBrightWhite = 'background-bright-white'
}
