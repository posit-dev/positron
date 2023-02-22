//
// dev_desc.rs
//
// Copyright (C) 2022 by Posit Software, PBC
//
//

#![allow(non_snake_case)]

use libR_sys::*;

// This file captures the device description for the different versions
// of R graphics engines that we support.

// Graphics Engine version 13 (R 4.0.x)
#[repr(C)]
#[derive(Copy, Clone)]
pub struct DevDescVersion13 {
    pub left: f64,
    pub right: f64,
    pub bottom: f64,
    pub top: f64,
    pub clipLeft: f64,
    pub clipRight: f64,
    pub clipBottom: f64,
    pub clipTop: f64,
    pub xCharOffset: f64,
    pub yCharOffset: f64,
    pub yLineBias: f64,
    pub ipr: [f64; 2usize],
    pub cra: [f64; 2usize],
    pub gamma: f64,
    pub canClip: Rboolean,
    pub canChangeGamma: Rboolean,
    pub canHAdj: ::std::os::raw::c_int,
    pub startps: f64,
    pub startcol: ::std::os::raw::c_int,
    pub startfill: ::std::os::raw::c_int,
    pub startlty: ::std::os::raw::c_int,
    pub startfont: ::std::os::raw::c_int,
    pub startgamma: f64,
    pub deviceSpecific: *mut ::std::os::raw::c_void,
    pub displayListOn: Rboolean,
    pub canGenMouseDown: Rboolean,
    pub canGenMouseMove: Rboolean,
    pub canGenMouseUp: Rboolean,
    pub canGenKeybd: Rboolean,
    pub canGenIdle: Rboolean,
    pub gettingEvent: Rboolean,
    pub activate: ::std::option::Option<unsafe extern "C" fn(arg1: pDevDesc)>,
    pub circle: ::std::option::Option<
        unsafe extern "C" fn(x: f64, y: f64, r: f64, gc: pGEcontext, dd: pDevDesc),
    >,
    pub clip: ::std::option::Option<
        unsafe extern "C" fn(x0: f64, x1: f64, y0: f64, y1: f64, dd: pDevDesc),
    >,
    pub close: ::std::option::Option<unsafe extern "C" fn(dd: pDevDesc)>,
    pub deactivate: ::std::option::Option<unsafe extern "C" fn(arg1: pDevDesc)>,
    pub locator: ::std::option::Option<
        unsafe extern "C" fn(x: *mut f64, y: *mut f64, dd: pDevDesc) -> Rboolean,
    >,
    pub line: ::std::option::Option<
        unsafe extern "C" fn(x1: f64, y1: f64, x2: f64, y2: f64, gc: pGEcontext, dd: pDevDesc),
    >,
    pub metricInfo: ::std::option::Option<
        unsafe extern "C" fn(
            c: ::std::os::raw::c_int,
            gc: pGEcontext,
            ascent: *mut f64,
            descent: *mut f64,
            width: *mut f64,
            dd: pDevDesc,
        ),
    >,
    pub mode:
        ::std::option::Option<unsafe extern "C" fn(mode: ::std::os::raw::c_int, dd: pDevDesc)>,
    pub newPage: ::std::option::Option<unsafe extern "C" fn(gc: pGEcontext, dd: pDevDesc)>,
    pub polygon: ::std::option::Option<
        unsafe extern "C" fn(
            n: ::std::os::raw::c_int,
            x: *mut f64,
            y: *mut f64,
            gc: pGEcontext,
            dd: pDevDesc,
        ),
    >,
    pub polyline: ::std::option::Option<
        unsafe extern "C" fn(
            n: ::std::os::raw::c_int,
            x: *mut f64,
            y: *mut f64,
            gc: pGEcontext,
            dd: pDevDesc,
        ),
    >,
    pub rect: ::std::option::Option<
        unsafe extern "C" fn(x0: f64, y0: f64, x1: f64, y1: f64, gc: pGEcontext, dd: pDevDesc),
    >,
    pub path: ::std::option::Option<
        unsafe extern "C" fn(
            x: *mut f64,
            y: *mut f64,
            npoly: ::std::os::raw::c_int,
            nper: *mut ::std::os::raw::c_int,
            winding: Rboolean,
            gc: pGEcontext,
            dd: pDevDesc,
        ),
    >,
    pub raster: ::std::option::Option<
        unsafe extern "C" fn(
            raster: *mut ::std::os::raw::c_uint,
            w: ::std::os::raw::c_int,
            h: ::std::os::raw::c_int,
            x: f64,
            y: f64,
            width: f64,
            height: f64,
            rot: f64,
            interpolate: Rboolean,
            gc: pGEcontext,
            dd: pDevDesc,
        ),
    >,
    pub cap: ::std::option::Option<unsafe extern "C" fn(dd: pDevDesc) -> SEXP>,
    pub size: ::std::option::Option<
        unsafe extern "C" fn(
            left: *mut f64,
            right: *mut f64,
            bottom: *mut f64,
            top: *mut f64,
            dd: pDevDesc,
        ),
    >,
    pub strWidth: ::std::option::Option<
        unsafe extern "C" fn(
            str: *const ::std::os::raw::c_char,
            gc: pGEcontext,
            dd: pDevDesc,
        ) -> f64,
    >,
    pub text: ::std::option::Option<
        unsafe extern "C" fn(
            x: f64,
            y: f64,
            str: *const ::std::os::raw::c_char,
            rot: f64,
            hadj: f64,
            gc: pGEcontext,
            dd: pDevDesc,
        ),
    >,
    pub onExit: ::std::option::Option<unsafe extern "C" fn(dd: pDevDesc)>,
    pub getEvent: ::std::option::Option<
        unsafe extern "C" fn(arg1: SEXP, arg2: *const ::std::os::raw::c_char) -> SEXP,
    >,
    pub newFrameConfirm: ::std::option::Option<unsafe extern "C" fn(dd: pDevDesc) -> Rboolean>,
    pub hasTextUTF8: Rboolean,
    pub textUTF8: ::std::option::Option<
        unsafe extern "C" fn(
            x: f64,
            y: f64,
            str: *const ::std::os::raw::c_char,
            rot: f64,
            hadj: f64,
            gc: pGEcontext,
            dd: pDevDesc,
        ),
    >,
    pub strWidthUTF8: ::std::option::Option<
        unsafe extern "C" fn(
            str: *const ::std::os::raw::c_char,
            gc: pGEcontext,
            dd: pDevDesc,
        ) -> f64,
    >,
    pub wantSymbolUTF8: Rboolean,
    pub useRotatedTextInContour: Rboolean,
    pub eventEnv: SEXP,
    pub eventHelper:
        ::std::option::Option<unsafe extern "C" fn(dd: pDevDesc, code: ::std::os::raw::c_int)>,
    pub holdflush: ::std::option::Option<
        unsafe extern "C" fn(dd: pDevDesc, level: ::std::os::raw::c_int) -> ::std::os::raw::c_int,
    >,
    pub haveTransparency: ::std::os::raw::c_int,
    pub haveTransparentBg: ::std::os::raw::c_int,
    pub haveRaster: ::std::os::raw::c_int,
    pub haveCapture: ::std::os::raw::c_int,
    pub haveLocator: ::std::os::raw::c_int,
    pub reserved: [::std::os::raw::c_char; 64usize],
}


// Graphics Engine version 14 (R 4.1.x)
#[repr(C)]
#[derive(Copy, Clone)]
pub struct DevDescVersion14 {
    pub left: f64,
    pub right: f64,
    pub bottom: f64,
    pub top: f64,
    pub clipLeft: f64,
    pub clipRight: f64,
    pub clipBottom: f64,
    pub clipTop: f64,
    pub xCharOffset: f64,
    pub yCharOffset: f64,
    pub yLineBias: f64,
    pub ipr: [f64; 2usize],
    pub cra: [f64; 2usize],
    pub gamma: f64,
    pub canClip: Rboolean,
    pub canChangeGamma: Rboolean,
    pub canHAdj: ::std::os::raw::c_int,
    pub startps: f64,
    pub startcol: ::std::os::raw::c_int,
    pub startfill: ::std::os::raw::c_int,
    pub startlty: ::std::os::raw::c_int,
    pub startfont: ::std::os::raw::c_int,
    pub startgamma: f64,
    pub deviceSpecific: *mut ::std::os::raw::c_void,
    pub displayListOn: Rboolean,
    pub canGenMouseDown: Rboolean,
    pub canGenMouseMove: Rboolean,
    pub canGenMouseUp: Rboolean,
    pub canGenKeybd: Rboolean,
    pub canGenIdle: Rboolean,
    pub gettingEvent: Rboolean,
    pub activate: ::std::option::Option<unsafe extern "C" fn(arg1: pDevDesc)>,
    pub circle: ::std::option::Option<
        unsafe extern "C" fn(x: f64, y: f64, r: f64, gc: pGEcontext, dd: pDevDesc),
    >,
    pub clip: ::std::option::Option<
        unsafe extern "C" fn(x0: f64, x1: f64, y0: f64, y1: f64, dd: pDevDesc),
    >,
    pub close: ::std::option::Option<unsafe extern "C" fn(dd: pDevDesc)>,
    pub deactivate: ::std::option::Option<unsafe extern "C" fn(arg1: pDevDesc)>,
    pub locator: ::std::option::Option<
        unsafe extern "C" fn(x: *mut f64, y: *mut f64, dd: pDevDesc) -> Rboolean,
    >,
    pub line: ::std::option::Option<
        unsafe extern "C" fn(x1: f64, y1: f64, x2: f64, y2: f64, gc: pGEcontext, dd: pDevDesc),
    >,
    pub metricInfo: ::std::option::Option<
        unsafe extern "C" fn(
            c: ::std::os::raw::c_int,
            gc: pGEcontext,
            ascent: *mut f64,
            descent: *mut f64,
            width: *mut f64,
            dd: pDevDesc,
        ),
    >,
    pub mode:
        ::std::option::Option<unsafe extern "C" fn(mode: ::std::os::raw::c_int, dd: pDevDesc)>,
    pub newPage: ::std::option::Option<unsafe extern "C" fn(gc: pGEcontext, dd: pDevDesc)>,
    pub polygon: ::std::option::Option<
        unsafe extern "C" fn(
            n: ::std::os::raw::c_int,
            x: *mut f64,
            y: *mut f64,
            gc: pGEcontext,
            dd: pDevDesc,
        ),
    >,
    pub polyline: ::std::option::Option<
        unsafe extern "C" fn(
            n: ::std::os::raw::c_int,
            x: *mut f64,
            y: *mut f64,
            gc: pGEcontext,
            dd: pDevDesc,
        ),
    >,
    pub rect: ::std::option::Option<
        unsafe extern "C" fn(x0: f64, y0: f64, x1: f64, y1: f64, gc: pGEcontext, dd: pDevDesc),
    >,
    pub path: ::std::option::Option<
        unsafe extern "C" fn(
            x: *mut f64,
            y: *mut f64,
            npoly: ::std::os::raw::c_int,
            nper: *mut ::std::os::raw::c_int,
            winding: Rboolean,
            gc: pGEcontext,
            dd: pDevDesc,
        ),
    >,
    pub raster: ::std::option::Option<
        unsafe extern "C" fn(
            raster: *mut ::std::os::raw::c_uint,
            w: ::std::os::raw::c_int,
            h: ::std::os::raw::c_int,
            x: f64,
            y: f64,
            width: f64,
            height: f64,
            rot: f64,
            interpolate: Rboolean,
            gc: pGEcontext,
            dd: pDevDesc,
        ),
    >,
    pub cap: ::std::option::Option<unsafe extern "C" fn(dd: pDevDesc) -> SEXP>,
    pub size: ::std::option::Option<
        unsafe extern "C" fn(
            left: *mut f64,
            right: *mut f64,
            bottom: *mut f64,
            top: *mut f64,
            dd: pDevDesc,
        ),
    >,
    pub strWidth: ::std::option::Option<
        unsafe extern "C" fn(
            str: *const ::std::os::raw::c_char,
            gc: pGEcontext,
            dd: pDevDesc,
        ) -> f64,
    >,
    pub text: ::std::option::Option<
        unsafe extern "C" fn(
            x: f64,
            y: f64,
            str: *const ::std::os::raw::c_char,
            rot: f64,
            hadj: f64,
            gc: pGEcontext,
            dd: pDevDesc,
        ),
    >,
    pub onExit: ::std::option::Option<unsafe extern "C" fn(dd: pDevDesc)>,
    pub getEvent: ::std::option::Option<
        unsafe extern "C" fn(arg1: SEXP, arg2: *const ::std::os::raw::c_char) -> SEXP,
    >,
    pub newFrameConfirm: ::std::option::Option<unsafe extern "C" fn(dd: pDevDesc) -> Rboolean>,
    pub hasTextUTF8: Rboolean,
    pub textUTF8: ::std::option::Option<
        unsafe extern "C" fn(
            x: f64,
            y: f64,
            str: *const ::std::os::raw::c_char,
            rot: f64,
            hadj: f64,
            gc: pGEcontext,
            dd: pDevDesc,
        ),
    >,
    pub strWidthUTF8: ::std::option::Option<
        unsafe extern "C" fn(
            str: *const ::std::os::raw::c_char,
            gc: pGEcontext,
            dd: pDevDesc,
        ) -> f64,
    >,
    pub wantSymbolUTF8: Rboolean,
    pub useRotatedTextInContour: Rboolean,
    pub eventEnv: SEXP,
    pub eventHelper:
        ::std::option::Option<unsafe extern "C" fn(dd: pDevDesc, code: ::std::os::raw::c_int)>,
    pub holdflush: ::std::option::Option<
        unsafe extern "C" fn(dd: pDevDesc, level: ::std::os::raw::c_int) -> ::std::os::raw::c_int,
    >,
    pub haveTransparency: ::std::os::raw::c_int,
    pub haveTransparentBg: ::std::os::raw::c_int,
    pub haveRaster: ::std::os::raw::c_int,
    pub haveCapture: ::std::os::raw::c_int,
    pub haveLocator: ::std::os::raw::c_int,
    pub setPattern:
        ::std::option::Option<unsafe extern "C" fn(pattern: SEXP, dd: pDevDesc) -> SEXP>,
    pub releasePattern: ::std::option::Option<unsafe extern "C" fn(ref_: SEXP, dd: pDevDesc)>,
    pub setClipPath:
        ::std::option::Option<unsafe extern "C" fn(path: SEXP, ref_: SEXP, dd: pDevDesc) -> SEXP>,
    pub releaseClipPath: ::std::option::Option<unsafe extern "C" fn(ref_: SEXP, dd: pDevDesc)>,
    pub setMask:
        ::std::option::Option<unsafe extern "C" fn(path: SEXP, ref_: SEXP, dd: pDevDesc) -> SEXP>,
    pub releaseMask: ::std::option::Option<unsafe extern "C" fn(ref_: SEXP, dd: pDevDesc)>,
    pub deviceVersion: ::std::os::raw::c_int,
    pub deviceClip: Rboolean,
    pub reserved: [::std::os::raw::c_char; 64usize],
}


// Graphics Engine version 15 (R 4.2.x)
#[repr(C)]
#[derive(Copy, Clone)]
pub struct DevDescVersion15 {
    pub left: f64,
    pub right: f64,
    pub bottom: f64,
    pub top: f64,
    pub clipLeft: f64,
    pub clipRight: f64,
    pub clipBottom: f64,
    pub clipTop: f64,
    pub xCharOffset: f64,
    pub yCharOffset: f64,
    pub yLineBias: f64,
    pub ipr: [f64; 2usize],
    pub cra: [f64; 2usize],
    pub gamma: f64,
    pub canClip: Rboolean,
    pub canChangeGamma: Rboolean,
    pub canHAdj: ::std::os::raw::c_int,
    pub startps: f64,
    pub startcol: ::std::os::raw::c_int,
    pub startfill: ::std::os::raw::c_int,
    pub startlty: ::std::os::raw::c_int,
    pub startfont: ::std::os::raw::c_int,
    pub startgamma: f64,
    pub deviceSpecific: *mut ::std::os::raw::c_void,
    pub displayListOn: Rboolean,
    pub canGenMouseDown: Rboolean,
    pub canGenMouseMove: Rboolean,
    pub canGenMouseUp: Rboolean,
    pub canGenKeybd: Rboolean,
    pub canGenIdle: Rboolean,
    pub gettingEvent: Rboolean,
    pub activate: ::std::option::Option<unsafe extern "C" fn(arg1: pDevDesc)>,
    pub circle: ::std::option::Option<
        unsafe extern "C" fn(x: f64, y: f64, r: f64, gc: pGEcontext, dd: pDevDesc),
    >,
    pub clip: ::std::option::Option<
        unsafe extern "C" fn(x0: f64, x1: f64, y0: f64, y1: f64, dd: pDevDesc),
    >,
    pub close: ::std::option::Option<unsafe extern "C" fn(dd: pDevDesc)>,
    pub deactivate: ::std::option::Option<unsafe extern "C" fn(arg1: pDevDesc)>,
    pub locator: ::std::option::Option<
        unsafe extern "C" fn(x: *mut f64, y: *mut f64, dd: pDevDesc) -> Rboolean,
    >,
    pub line: ::std::option::Option<
        unsafe extern "C" fn(x1: f64, y1: f64, x2: f64, y2: f64, gc: pGEcontext, dd: pDevDesc),
    >,
    pub metricInfo: ::std::option::Option<
        unsafe extern "C" fn(
            c: ::std::os::raw::c_int,
            gc: pGEcontext,
            ascent: *mut f64,
            descent: *mut f64,
            width: *mut f64,
            dd: pDevDesc,
        ),
    >,
    pub mode:
        ::std::option::Option<unsafe extern "C" fn(mode: ::std::os::raw::c_int, dd: pDevDesc)>,
    pub newPage: ::std::option::Option<unsafe extern "C" fn(gc: pGEcontext, dd: pDevDesc)>,
    pub polygon: ::std::option::Option<
        unsafe extern "C" fn(
            n: ::std::os::raw::c_int,
            x: *mut f64,
            y: *mut f64,
            gc: pGEcontext,
            dd: pDevDesc,
        ),
    >,
    pub polyline: ::std::option::Option<
        unsafe extern "C" fn(
            n: ::std::os::raw::c_int,
            x: *mut f64,
            y: *mut f64,
            gc: pGEcontext,
            dd: pDevDesc,
        ),
    >,
    pub rect: ::std::option::Option<
        unsafe extern "C" fn(x0: f64, y0: f64, x1: f64, y1: f64, gc: pGEcontext, dd: pDevDesc),
    >,
    pub path: ::std::option::Option<
        unsafe extern "C" fn(
            x: *mut f64,
            y: *mut f64,
            npoly: ::std::os::raw::c_int,
            nper: *mut ::std::os::raw::c_int,
            winding: Rboolean,
            gc: pGEcontext,
            dd: pDevDesc,
        ),
    >,
    pub raster: ::std::option::Option<
        unsafe extern "C" fn(
            raster: *mut ::std::os::raw::c_uint,
            w: ::std::os::raw::c_int,
            h: ::std::os::raw::c_int,
            x: f64,
            y: f64,
            width: f64,
            height: f64,
            rot: f64,
            interpolate: Rboolean,
            gc: pGEcontext,
            dd: pDevDesc,
        ),
    >,
    pub cap: ::std::option::Option<unsafe extern "C" fn(dd: pDevDesc) -> SEXP>,
    pub size: ::std::option::Option<
        unsafe extern "C" fn(
            left: *mut f64,
            right: *mut f64,
            bottom: *mut f64,
            top: *mut f64,
            dd: pDevDesc,
        ),
    >,
    pub strWidth: ::std::option::Option<
        unsafe extern "C" fn(
            str: *const ::std::os::raw::c_char,
            gc: pGEcontext,
            dd: pDevDesc,
        ) -> f64,
    >,
    pub text: ::std::option::Option<
        unsafe extern "C" fn(
            x: f64,
            y: f64,
            str: *const ::std::os::raw::c_char,
            rot: f64,
            hadj: f64,
            gc: pGEcontext,
            dd: pDevDesc,
        ),
    >,
    pub onExit: ::std::option::Option<unsafe extern "C" fn(dd: pDevDesc)>,
    pub getEvent: ::std::option::Option<
        unsafe extern "C" fn(arg1: SEXP, arg2: *const ::std::os::raw::c_char) -> SEXP,
    >,
    pub newFrameConfirm: ::std::option::Option<unsafe extern "C" fn(dd: pDevDesc) -> Rboolean>,
    pub hasTextUTF8: Rboolean,
    pub textUTF8: ::std::option::Option<
        unsafe extern "C" fn(
            x: f64,
            y: f64,
            str: *const ::std::os::raw::c_char,
            rot: f64,
            hadj: f64,
            gc: pGEcontext,
            dd: pDevDesc,
        ),
    >,
    pub strWidthUTF8: ::std::option::Option<
        unsafe extern "C" fn(
            str: *const ::std::os::raw::c_char,
            gc: pGEcontext,
            dd: pDevDesc,
        ) -> f64,
    >,
    pub wantSymbolUTF8: Rboolean,
    pub useRotatedTextInContour: Rboolean,
    pub eventEnv: SEXP,
    pub eventHelper:
        ::std::option::Option<unsafe extern "C" fn(dd: pDevDesc, code: ::std::os::raw::c_int)>,
    pub holdflush: ::std::option::Option<
        unsafe extern "C" fn(dd: pDevDesc, level: ::std::os::raw::c_int) -> ::std::os::raw::c_int,
    >,
    pub haveTransparency: ::std::os::raw::c_int,
    pub haveTransparentBg: ::std::os::raw::c_int,
    pub haveRaster: ::std::os::raw::c_int,
    pub haveCapture: ::std::os::raw::c_int,
    pub haveLocator: ::std::os::raw::c_int,
    pub setPattern:
        ::std::option::Option<unsafe extern "C" fn(pattern: SEXP, dd: pDevDesc) -> SEXP>,
    pub releasePattern: ::std::option::Option<unsafe extern "C" fn(ref_: SEXP, dd: pDevDesc)>,
    pub setClipPath:
        ::std::option::Option<unsafe extern "C" fn(path: SEXP, ref_: SEXP, dd: pDevDesc) -> SEXP>,
    pub releaseClipPath: ::std::option::Option<unsafe extern "C" fn(ref_: SEXP, dd: pDevDesc)>,
    pub setMask:
        ::std::option::Option<unsafe extern "C" fn(path: SEXP, ref_: SEXP, dd: pDevDesc) -> SEXP>,
    pub releaseMask: ::std::option::Option<unsafe extern "C" fn(ref_: SEXP, dd: pDevDesc)>,
    pub deviceVersion: ::std::os::raw::c_int,
    pub deviceClip: Rboolean,
    pub defineGroup: ::std::option::Option<
        unsafe extern "C" fn(
            source: SEXP,
            op: ::std::os::raw::c_int,
            destination: SEXP,
            dd: pDevDesc,
        ) -> SEXP,
    >,
    pub useGroup:
        ::std::option::Option<unsafe extern "C" fn(ref_: SEXP, trans: SEXP, dd: pDevDesc)>,
    pub releaseGroup: ::std::option::Option<unsafe extern "C" fn(ref_: SEXP, dd: pDevDesc)>,
    pub stroke:
        ::std::option::Option<unsafe extern "C" fn(path: SEXP, gc: pGEcontext, dd: pDevDesc)>,
    pub fill: ::std::option::Option<
        unsafe extern "C" fn(path: SEXP, rule: ::std::os::raw::c_int, gc: pGEcontext, dd: pDevDesc),
    >,
    pub fillStroke: ::std::option::Option<
        unsafe extern "C" fn(path: SEXP, rule: ::std::os::raw::c_int, gc: pGEcontext, dd: pDevDesc),
    >,
    pub capabilities: ::std::option::Option<unsafe extern "C" fn(cap: SEXP) -> SEXP>,
    pub reserved: [::std::os::raw::c_char; 64usize],
}
