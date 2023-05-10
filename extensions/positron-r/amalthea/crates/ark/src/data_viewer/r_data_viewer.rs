//
// r-data-viewer.rs
//
// Copyright (C) 2023 by Posit Software, PBC
//
//

use amalthea::comm::event::CommEvent;
use amalthea::socket::comm::CommInitiator;
use amalthea::socket::comm::CommSocket;
use harp::object::RObject;
use stdext::spawn;
use uuid::Uuid;

use crate::lsp::globals::comm_manager_tx;

pub struct RDataViewer {
    pub data: RObject
}

impl RDataViewer {

    pub fn start(data: RObject) {
        spawn!("ark-data-viewer", move || {
            let viewer = Self {
                data
            };
            viewer.execution_thread();
        });
    }

    pub fn execution_thread(self) {

        let id = Uuid::new_v4().to_string();

        let socket = CommSocket::new(
            CommInitiator::BackEnd,
            id.clone(),
            String::from("positron.dataViewer"),
        );

        let comm_manager_tx = comm_manager_tx();

        // TODO: instead of Null, send a DataSet
        let event = CommEvent::Opened(socket.clone(), serde_json::Value::Null);
        if let Err(error) = comm_manager_tx.send(event) {
            log::error!("{}", error);
        }
    }
}
