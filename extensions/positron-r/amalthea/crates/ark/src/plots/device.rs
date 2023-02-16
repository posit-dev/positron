//
// device.rs
//
// Copyright (C) 2022 by Posit Software, PBC
//
//

#![allow(non_snake_case)]
#![allow(unused_variables)]

use harp::interrupts::RInterruptsSuspendedScope;
use libR_sys::*;
use stdext::cstr;

static mut POSITRON_GRAPHICS_DEVICE : pGEDevDesc = std::ptr::null_mut();

fn trace(label: &str) {
    log::info!("[plots] {}", label);
}

extern "C" fn gd_activate(dd: pDevDesc) {
    trace("gd_activate");
}

extern "C" fn gd_circle(x: f64, y: f64, radius: f64, gc: pGEcontext, dd: pDevDesc) {
    trace("gd_circle");
}

extern "C" fn gd_clip(x0: f64, x1: f64, y0: f64, y1: f64, dd: pDevDesc) {
    trace("gd_clip");
}

unsafe extern "C" fn gd_close(dd: pDevDesc) {
    trace("gd_close");

    // NOTE: R will take care of deallocating the graphics device
    // itself, so we don't need to do anything here -- we'd only
    // want to free device-specific components not managed by R.
    //
    // Older versions of Rust used jemalloc by default, but nowadays
    // Rust uses the system's "default" allocator and so it should
    // hopefully be safe to let R free the memory allocated here.
    //
    // https://github.com/wch/r-source/blob/9065779ee510b7bd8ca93d08f4dd4b6e2bd31923/src/main/engine.c#L75-L87
}

extern "C" fn gd_deactivate(dd: pDevDesc) {
    trace("gd_deactivate");
}

extern "C" fn gd_locator(x: *mut f64, y: *mut f64, dd: pDevDesc) -> Rboolean {
    trace("gd_locator");
    return 0;
}

extern "C" fn gd_line(x1: f64, y1: f64, x2: f64, y2: f64, gc: pGEcontext, dd: pDevDesc) {
    trace("gd_line");
}

extern "C" fn gd_metricInfo(c: i32, gc: pGEcontext, ascent: *mut f64, descent: *mut f64, width: *mut f64, dd: pDevDesc) {
    trace("gd_metricInfo");
}

extern "C" fn gd_mode(mode: i32, dd: pDevDesc) {
    trace("gd_mode");
}

extern "C" fn gd_newPage(gc: pGEcontext, dd: pDevDesc) {
    trace("gd_newPage");
}

extern "C" fn gd_polygon(n: i32, x: *mut f64, y: *mut f64, gc: pGEcontext, dd: pDevDesc) {
    trace("gd_polygon");
}

extern "C" fn gd_polyline(n: i32, x: *mut f64, y: *mut f64, gc: pGEcontext, dd: pDevDesc) {
    trace("gd_polyline");
}

extern "C" fn gd_rect(x0: f64, y0: f64, x1: f64, y1: f64, gc: pGEcontext, dd: pDevDesc) {
    trace("gd_rect");
}

extern "C" fn gd_path(
    x: *mut f64, y: *mut f64,
    npoly: i32, nper: *mut i32,
    winding: Rboolean,
    gc: pGEcontext, dd: pDevDesc
) {
    trace("gd_path");
}

extern "C" fn gd_raster(
    raster: *mut u32, w: i32, h: i32,
    x: f64, y: f64,
    width: f64, height: f64,
    rot: f64,
    interpolate: Rboolean,
    gc: pGEcontext, dd: pDevDesc
) {
    trace("gd_raster");
}

extern "C" fn gd_cap(dd: pDevDesc) -> SEXP {
    trace("gd_cap");
    return unsafe { R_NilValue };
}

extern "C" fn gd_size(left: *mut f64, right: *mut f64, bottom: *mut f64, top: *mut f64, dd: pDevDesc) {
    trace("gd_size");
}

extern "C" fn gd_strWidth(str: *const i8, gc: pGEcontext, dd: pDevDesc) -> f64 {
    trace("gd_strWidth");
    return 0.into();
}

extern "C" fn gd_text(x: f64, y: f64, str: *const i8, rot: f64, hadj: f64, gc: pGEcontext, dd: pDevDesc) {
    trace("gd_text");
}

extern "C" fn gd_onExit(dd: pDevDesc) {
    trace("gd_onExit");
}

extern "C" fn gd_getEvent(data: SEXP, name: *const i8) -> SEXP {
    trace("gd_getEvent");
    return data;
}

extern "C" fn gd_newFrameConfirm(dd: pDevDesc) -> Rboolean {
    trace("gd_newFrameConfirm");
    return 1;
}

extern "C" fn gd_textUTF8(x: f64, y: f64, str: *const i8, rot: f64, hadj: f64, gc: pGEcontext, dd: pDevDesc) {
    trace("gd_textUTF8");
}

extern "C" fn gd_strWidthUTF8(str: *const i8, gc: pGEcontext, dd: pDevDesc) -> f64 {
    trace("gd_strWidthUTF8");
    return 0.into();
}

extern "C" fn gd_eventHelper(dd: pDevDesc, code: i32) {
    trace("gd_eventHelper");
}

extern "C" fn gd_holdflush(dd: pDevDesc, level: i32) -> i32 {
    trace("gd_holdflush");
    return 0;
}

unsafe extern "C" fn gd_setPattern(pattern: SEXP, dd: pDevDesc) -> SEXP {
    trace("gd_setPattern");
    return R_NilValue;
}

extern "C" fn gd_releasePattern(reference: SEXP, dd: pDevDesc) {
    trace("gd_releasePattern");
}

unsafe extern "C" fn gd_setClipPath(path: SEXP, reference: SEXP, dd: pDevDesc) -> SEXP {
    trace("gd_setClipPath");
    return R_NilValue;
}

extern "C" fn gd_releaseClipPath(reference: SEXP, dd: pDevDesc) {
    trace("gd_releaseClipPath");
}

unsafe extern "C" fn gd_setMask(path: SEXP, reference: SEXP, dd: pDevDesc) -> SEXP {
    trace("gd_setMask");
    return R_NilValue;
}

extern "C" fn gd_releaseMask(reference: SEXP, dd: pDevDesc) {
    trace("gd_releaseMask");
}

unsafe extern "C" fn gd_defineGroup(source: SEXP, op: i32, destination: SEXP, dd: pDevDesc) -> SEXP {
    trace("gd_defineGroup");
    return R_NilValue;
}

extern "C" fn gd_useGroup(reference: SEXP, trans: SEXP, dd: pDevDesc) {
    trace("gd_useGroup");
}

extern "C" fn gd_releaseGroup(reference: SEXP, dd: pDevDesc) {
    trace("gd_releaseGroup");
}

extern "C" fn gd_stroke(path: SEXP, gc: pGEcontext, dd: pDevDesc) {
    trace("gd_stroke");
}

extern "C" fn gd_fill(path: SEXP, rule: i32, gc: pGEcontext, dd: pDevDesc) {
    trace("gd_fill");
}

extern "C" fn gd_fillStroke(path: SEXP, rule: i32, gc: pGEcontext, dd: pDevDesc) {
    trace("gd_fillStroke");
}

unsafe extern "C" fn gd_capabilities(cap: SEXP) -> SEXP {
    trace("gd_capabilities");
    return R_NilValue;
}

#[harp::register]
unsafe extern "C" fn ps_graphics_device() -> SEXP {

    // TODO: Error if there are no devices available.
    // R_CheckDeviceAvailable();

    // disable interrupts in this scope
    let scope = RInterruptsSuspendedScope::new();

    // TODO: Do the dance where we pick the right version of the
    // device description based on the version of R we're using.
    //
    // We create the "newest" version of the device structure here,
    // and then adapt that later as appropriate for the version of
    // R actually being used.

    let dev = Box::new(DevDesc {
        left: 0.0,
        right: 0.0,
        bottom: 0.0,
        top: 0.0,
        clipLeft: 0.0,
        clipRight: 0.0,
        clipBottom: 0.0,
        clipTop: 0.0,
        xCharOffset: 0.0,
        yCharOffset: 0.0,
        yLineBias: 0.0,
        ipr: [0.0, 0.0],
        cra: [0.0, 0.0],
        gamma: 0.0,
        canClip: 0,
        canChangeGamma: 0,
        canHAdj: 0,
        startps: 0.0,
        startcol: 0,
        startfill: 0,
        startlty: 0,
        startfont: 0,
        startgamma: 0.0,
        deviceSpecific: std::ptr::null_mut(),
        displayListOn: 0,
        canGenMouseDown: 0,
        canGenMouseMove: 0,
        canGenMouseUp: 0,
        canGenKeybd: 0,
        canGenIdle: 0,
        gettingEvent: 0,

        activate: Some(gd_activate),
        circle: Some(gd_circle),
        clip: Some(gd_clip),
        close: Some(gd_close),
        deactivate: Some(gd_deactivate),
        locator: Some(gd_locator),
        line: Some(gd_line),
        metricInfo: Some(gd_metricInfo),
        mode: Some(gd_mode),
        newPage: Some(gd_newPage),
        polygon: Some(gd_polygon),
        polyline: Some(gd_polyline),
        rect: Some(gd_rect),

        path: Some(gd_path),
        raster: Some(gd_raster),
        cap: Some(gd_cap),

        size: Some(gd_size),
        strWidth: Some(gd_strWidth),
        text: Some(gd_text),
        onExit: Some(gd_onExit),
        getEvent: Some(gd_getEvent),
        newFrameConfirm: Some(gd_newFrameConfirm),

        hasTextUTF8: 0,
        textUTF8: Some(gd_textUTF8),
        strWidthUTF8: Some(gd_strWidthUTF8),
        wantSymbolUTF8: 0,
        useRotatedTextInContour: 0,

        eventEnv: R_NilValue,
        eventHelper: Some(gd_eventHelper),

        holdflush: Some(gd_holdflush),
        haveTransparency: 0,
        haveTransparentBg: 0,
        haveRaster: 0,
        haveCapture: 0,
        haveLocator: 0,

        setPattern: Some(gd_setPattern),
        releasePattern: Some(gd_releasePattern),

        setClipPath: Some(gd_setClipPath),
        releaseClipPath: Some(gd_releaseClipPath),

        setMask: Some(gd_setMask),
        releaseMask: Some(gd_releaseMask),

        deviceVersion: 0,
        deviceClip: 0,

        defineGroup: Some(gd_defineGroup),
        useGroup: Some(gd_useGroup),
        releaseGroup: Some(gd_releaseGroup),

        stroke: Some(gd_stroke),
        fill: Some(gd_fill),
        fillStroke: Some(gd_fillStroke),

        capabilities: Some(gd_capabilities),

        reserved: [0; 64],
    });

    // tell Rust not to automatically drop 'dev'; we'll handle this ourselves
    let dev = Box::leak(dev);

    // adapt our device description to the version appropriate
    // for the currently-running version of R
    //
    // TODO: copy the relevant devdesc headers here
    POSITRON_GRAPHICS_DEVICE = GEcreateDevDesc(dev);
    GEaddDevice2(POSITRON_GRAPHICS_DEVICE, cstr!("Positron Graphics Device"));

    let number = Rf_ndevNumber((*POSITRON_GRAPHICS_DEVICE).dev);
    Rf_selectDevice(number);

    return R_NilValue;

}
