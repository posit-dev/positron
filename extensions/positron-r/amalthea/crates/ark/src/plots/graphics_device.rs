//
// device.rs
//
// Copyright (C) 2022 by Posit Software, PBC
//
//

use harp::exec::RFunction;
use harp::exec::RFunctionExt;
use libR_sys::*;
use once_cell::sync::Lazy;

#[derive(Debug, Default)]
struct DeviceCallbacks {
    pub mode: Option<unsafe extern "C" fn(i32, pDevDesc)>,
}

static mut DEVICE_CALLBACKS : Lazy<DeviceCallbacks> = Lazy::new(|| {
    DeviceCallbacks::default()
});

macro_rules! trace {
    ($($tts:tt)*) => {{
        let message = format!($($tts)*);
        log::info!("[plots] {}", message);
    }}
}

unsafe extern "C" fn gd_mode(mode: i32, dev: pDevDesc) {
    trace!("gd_mode: {}", mode);

    if let Some(callback) = DEVICE_CALLBACKS.mode {
        callback(mode, dev);
    }
}

unsafe fn ps_graphics_device_impl() -> anyhow::Result<SEXP> {

    // TODO: Don't allow creation of more than one graphics device.
    // TODO: Allow customization of the graphics device here?
    // create the graphics device via R APIs
    let filename = RFunction::new("base", "tempfile")
        .param("pattern", "positron-graphics-")
        .param("fileext", ".png")
        .call()?
        .to::<String>()?;

    RFunction::new("grDevices", "png")
        .param("filename", filename)
        .call()?;

    // rename the current device
    let index = Rf_curDevice() + 1;  // C -> R indexing
    RFunction::from(".ps.graphics.updateDeviceName")
        .param("name", "Positron Graphics Device")
        .param("index", index)
        .call()?;

    // get reference to current device
    let device = GEcurrentDevice();
    let device = (*device).dev;

    // time to monkey patch!
    DEVICE_CALLBACKS.mode = (*device).mode;
    (*device).mode = Some(gd_mode);

    Ok(R_NilValue)

}

#[harp::register]
unsafe extern "C" fn ps_graphics_device() -> SEXP {

    match ps_graphics_device_impl() {
        Ok(value) => value,
        Err(error) => {
            log::error!("{}", error);
            R_NilValue
        }
    }

}
