//
// graphics_device.rs
//
// Copyright (C) 2022 by Posit Software, PBC
//

///
/// The Positron Graphics Device.
///
/// Rather than implement a separate graphics device, Positron
/// allows the user to select their own graphics device, and
/// then monkey-patches it in a way that allows us to hook into
/// the various graphics events.
///
/// This approach is similar in spirit to the RStudio approach,
/// but is vastly simpler as we no longer need to implement and
/// synchronize two separate graphics devices.
///
/// See also:
///
/// https://github.com/wch/r-source/blob/trunk/src/include/R_ext/GraphicsDevice.h
/// https://github.com/wch/r-source/blob/trunk/src/include/R_ext/GraphicsEngine.h
/// https://github.com/rstudio/rstudio/blob/main/src/cpp/r/session/graphics/RGraphicsDevice.cpp
///
use std::collections::HashMap;
use std::fs::File;
use std::io::BufReader;
use std::io::Read;

use amalthea::comm::comm_channel::CommChannelMsg;
use amalthea::comm::event::CommEvent;
use amalthea::socket::comm::CommInitiator;
use amalthea::socket::comm::CommSocket;
use base64::engine::general_purpose;
use base64::Engine;
use crossbeam::channel::Select;
use harp::exec::RFunction;
use harp::exec::RFunctionExt;
use libR_sys::*;
use once_cell::sync::Lazy;
use stdext::unwrap;
use uuid::Uuid;

use crate::lsp::globals::comm_manager_tx;
use crate::plots::message::PlotMessageInput;
use crate::plots::message::PlotMessageInputRender;
use crate::plots::message::PlotMessageOutput;
use crate::plots::message::PlotMessageOutputImage;

const POSITRON_PLOT_CHANNEL_ID: &str = "positron.plot";

macro_rules! trace {
    ($($tts:tt)*) => {{
        let message = format!($($tts)*);
        log::info!("[graphics] {}", message);
    }}
}

#[derive(Debug, Default)]
#[allow(non_snake_case)]
struct DeviceCallbacks {
    pub activate: Option<unsafe extern "C" fn(pDevDesc)>,
    pub deactivate: Option<unsafe extern "C" fn(pDevDesc)>,
    pub holdflush: Option<unsafe extern "C" fn(pDevDesc, i32) -> i32>,
    pub mode: Option<unsafe extern "C" fn(i32, pDevDesc)>,
    pub newPage: Option<unsafe extern "C" fn(pGEcontext, pDevDesc)>,
}

#[derive(Default)]
struct DeviceContext {
    // Tracks whether the graphics device has changes.
    pub _dirty: bool,

    // Tracks the current graphics device mode.
    pub _mode: i32,

    // The 'holdflush' flag, as normally handled via a device's 'holdflush()'
    // callback. If 'dev.hold()' has been set, we want to avoid rendering
    // new plots.
    pub _holdflush: i32,

    // Whether we're currently rendering a plot. Mainly used to avoid
    // recursive plot invocations.
    pub _rendering: bool,

    // The ID associated with the current plot page. Used primarily
    // for accessing indexed plots, e.g. for the Plots pane history.
    pub _id: Option<String>,

    // A map, mapping plot IDs to the communication channels used
    // for communicating their rendered results to the front-end.
    pub _channels: HashMap<String, CommSocket>,

    // The device callbacks, which are patched into the device.
    pub _callbacks: DeviceCallbacks,
}

impl DeviceContext {
    pub unsafe fn holdflush(&mut self, holdflush: i32) {
        self._holdflush = holdflush;
    }

    pub unsafe fn mode(&mut self, mode: i32, _dev: pDevDesc) {
        self._mode = mode;
        self._dirty = self._dirty || mode != 0;
    }

    pub unsafe fn new_page(&mut self, _dd: pGEcontext, _dev: pDevDesc) {
        // Create a new id.
        let id = Uuid::new_v4().to_string();
        self._id = Some(id.clone());

        // Let Positron know that we just created a new plot.
        let socket = CommSocket::new(
            CommInitiator::BackEnd,
            id.clone(),
            POSITRON_PLOT_CHANNEL_ID.to_string(),
        );

        let event = CommEvent::Opened(socket.clone(), serde_json::Value::Null);
        let comm_manager_tx = comm_manager_tx();
        if let Err(error) = comm_manager_tx.send(event) {
            log::error!("{}", error);
        }

        // Save our new socket.
        self._channels.insert(id.clone(), socket.clone());
    }

    pub unsafe fn on_process_events(&mut self) {
        // Collect existing channels into a vector of tuples.
        // Necessary for handling Select in a clean way.
        let channels = self._channels.clone();
        let channels = channels.iter().collect::<Vec<_>>();

        // Check for incoming plot render requests.
        let mut select = Select::new();
        for (_id, channel) in channels.iter() {
            select.recv(&channel.incoming_rx);
        }

        let selection = unwrap!(select.try_select(), Err(_error) => {
            // We don't log errors here, since it's most likely that none
            // of the channels have any messages available.
            return;
        });

        let plot_id = channels.get_unchecked(selection.index()).0;
        let socket = channels.get_unchecked(selection.index()).1;
        let message = unwrap!(selection.recv(&socket.incoming_rx), Err(error) => {
            log::error!("{}", error);
            return;
        });

        // Get the RPC request.
        if let CommChannelMsg::Rpc(rpc_id, value) = message {
            let input = serde_json::from_value::<PlotMessageInput>(value);
            let input = unwrap!(input, Err(error) => {
                log::error!("{}", error);
                return;
            });

            match input {
                PlotMessageInput::Render(plot_meta) => {
                    let result = self.render_plot(plot_id, plot_meta, rpc_id.as_str(), socket);
                    if let Err(error) = result {
                        log::error!("{}", error);
                        return;
                    }
                },
            }
        }
    }

    pub unsafe fn render_plot(
        &mut self,
        plot_id: &str,
        plot_meta: PlotMessageInputRender,
        rpc_id: &str,
        socket: &CommSocket,
    ) -> anyhow::Result<()> {
        // Render the plot to file.
        // TODO: Is it possible to do this without writing to file; e.g. could
        // we instead write to a connection or something else?
        self._rendering = true;
        let result = RFunction::from(".ps.graphics.renderPlot")
            .param("id", plot_id)
            .param("width", plot_meta.width)
            .param("height", plot_meta.height)
            .param("dpr", plot_meta.pixel_ratio)
            .call();
        self._rendering = false;

        // Get the path to the image.
        let image_path = result?.to::<String>()?;

        // Read contents into bytes.
        let conn = File::open(image_path)?;
        let mut reader = BufReader::new(conn);

        let mut buffer = vec![];
        reader.read_to_end(&mut buffer)?;

        // what an odd interface
        let data = general_purpose::STANDARD_NO_PAD.encode(buffer);

        let response = PlotMessageOutput::Image(PlotMessageOutputImage {
            data: data,
            mime_type: "image/png".to_string(),
        });

        let json = serde_json::to_value(response).unwrap();
        socket
            .outgoing_tx
            .send(CommChannelMsg::Rpc(rpc_id.to_string(), json))?;

        Ok(())
    }
}

static mut DEVICE_CONTEXT: Lazy<DeviceContext> = Lazy::new(|| DeviceContext::default());

// TODO: This macro needs to be updated every time we introduce support
// for a new graphics device. Is there a better way?
macro_rules! with_device {
    ($value:expr, | $name:ident | $block:block) => {{
        let version = R_GE_getVersion();
        if version == 13 {
            let $name = $value as *mut $crate::plots::dev_desc::DevDescVersion13;
            $block;
        } else if version == 14 {
            let $name = $value as *mut $crate::plots::dev_desc::DevDescVersion14;
            $block;
        } else if version == 15 {
            let $name = $value as *mut $crate::plots::dev_desc::DevDescVersion15;
            $block;
        } else {
            panic!(
                "R graphics engine version {} is not supported by this version of Positron.",
                version
            )
        };
    }};
}

pub unsafe fn on_process_events() {
    let context = &mut DEVICE_CONTEXT;

    // Don't try to render a plot if we're currently drawing.
    if context._mode != 0 {
        return;
    }

    // Don't try to render a plot if the 'holdflush' flag is set.
    if context._holdflush > 0 {
        return;
    }

    DEVICE_CONTEXT.on_process_events();
}

// NOTE: May be called when rendering a plot to file, since this is done by
// copying the graphics display list to a new plot device, and then closing that device.
unsafe extern "C" fn gd_activate(dev: pDevDesc) {
    trace!("gd_activate");

    if let Some(callback) = DEVICE_CONTEXT._callbacks.activate {
        callback(dev);
    }
}

// NOTE: May be called when rendering a plot to file, since this is done by
// copying the graphics display list to a new plot device, and then closing that device.
unsafe extern "C" fn gd_deactivate(dev: pDevDesc) {
    trace!("gd_deactivate");

    if let Some(callback) = DEVICE_CONTEXT._callbacks.deactivate {
        callback(dev);
    }
}

unsafe extern "C" fn gd_hold_flush(dev: pDevDesc, mut holdflush: i32) -> i32 {
    trace!("gd_hold_flush");

    if let Some(callback) = DEVICE_CONTEXT._callbacks.holdflush {
        holdflush = callback(dev, holdflush);
    }

    DEVICE_CONTEXT.holdflush(holdflush);
    holdflush
}

// mode = 0, graphics off
// mode = 1, graphics on
// mode = 2, graphical input on (ignored by most drivers)
unsafe extern "C" fn gd_mode(mode: i32, dev: pDevDesc) {
    trace!("gd_mode: {}", mode);

    // invoke the regular callback
    if let Some(callback) = DEVICE_CONTEXT._callbacks.mode {
        callback(mode, dev);
    }

    DEVICE_CONTEXT.mode(mode, dev);
}

unsafe extern "C" fn gd_new_page(dd: pGEcontext, dev: pDevDesc) {
    trace!("gd_new_page");

    // invoke the regular callback
    if let Some(callback) = DEVICE_CONTEXT._callbacks.newPage {
        callback(dd, dev);
    }

    DEVICE_CONTEXT.new_page(dd, dev);
}

unsafe fn ps_graphics_device_impl() -> anyhow::Result<SEXP> {
    // TODO: Don't allow creation of more than one graphics device.
    // TODO: Allow customization of the graphics device here?

    // TODO: Infer appropriate resolution based on whether display is high DPI.
    let res = 144;

    // TODO: allow customization of device type.
    let r#type = "cairo";

    // Create the graphics device.
    RFunction::from(".ps.graphics.createDevice")
        .param("name", "Positron Graphics Device")
        .param("type", r#type)
        .param("res", res)
        .call()?;

    // get reference to current device
    let dd = GEcurrentDevice();

    // initialize our _callbacks
    let device = (*dd).dev;
    with_device!(device, |device| {
        // initialize display list (needed for copying of plots)
        GEinitDisplayList(dd);
        (*dd).displayListOn = 1;
        // (*dd).recordGraphics = 1;

        // device description struct
        let callbacks = &mut DEVICE_CONTEXT._callbacks;

        callbacks.activate = (*device).activate;
        (*device).activate = Some(gd_activate);

        callbacks.deactivate = (*device).deactivate;
        (*device).deactivate = Some(gd_deactivate);

        callbacks.holdflush = (*device).holdflush;
        (*device).holdflush = Some(gd_hold_flush);

        callbacks.mode = (*device).mode;
        (*device).mode = Some(gd_mode);

        callbacks.newPage = (*device).newPage;
        (*device).newPage = Some(gd_new_page);
    });

    Ok(R_NilValue)
}

#[harp::register]
unsafe extern "C" fn ps_graphics_device() -> SEXP {
    match ps_graphics_device_impl() {
        Ok(value) => value,
        Err(error) => {
            log::error!("{}", error);
            R_NilValue
        },
    }
}

#[harp::register]
unsafe extern "C" fn ps_graphics_event(_name: SEXP) -> SEXP {
    let id = unwrap!(DEVICE_CONTEXT._id.clone(), None => {
        return Rf_ScalarLogical(0);
    });

    let result = RFunction::from(".ps.graphics.createSnapshot")
        .param("id", id)
        .call();

    if let Err(error) = result {
        log::error!("{}", error);
        return Rf_ScalarLogical(0);
    }

    Rf_ScalarLogical(1)
}
