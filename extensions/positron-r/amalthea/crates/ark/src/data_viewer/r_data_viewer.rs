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
use harp::r_lock;
use harp::vector::CharacterVector;
use harp::vector::Vector;
use libR_sys::R_NamesSymbol;
use libR_sys::Rf_getAttrib;
use libR_sys::VECTOR_ELT;
use libR_sys::XLENGTH;
use serde::Deserialize;
use serde::Serialize;
use stdext::spawn;
use uuid::Uuid;

use crate::lsp::globals::comm_manager_tx;

pub struct RDataViewer {
    pub title: String,
    pub data: RObject
}

#[derive(Deserialize, Serialize)]
pub struct DataColumn {
    pub name: String,

    #[serde(rename = "type")]
    pub column_type: String,

    pub data: Vec<String>
}

#[derive(Deserialize, Serialize)]
pub struct DataSet {
    pub id: String,
    pub title: String,
    pub columns: Vec<DataColumn>,
    pub row_count: usize
}

impl DataSet {
    pub fn from_object(id: String, title: String, object: RObject) -> Self {

        let mut columns = vec![];

        r_lock! {
            let names = CharacterVector::new_unchecked(Rf_getAttrib(*object, R_NamesSymbol));

            let n_columns = XLENGTH(*object);
            for i in 0..n_columns {
                let data = harp::vector::format(VECTOR_ELT(*object, i));

                columns.push(DataColumn{
                    name: names.get_unchecked(i).unwrap(),
                    column_type: String::from("String"),
                    data
                });
            }
        }

        Self {
            id,
            title,
            columns,
            row_count: 0
        }
    }
}

impl RDataViewer {

    pub fn start(title: String, data: RObject) {
        spawn!("ark-data-viewer", move || {
            let viewer = Self {
                title,
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

        let data_set = DataSet::from_object(id, self.title, self.data);

        let json = serde_json::to_value(data_set).unwrap();

        let event = CommEvent::Opened(socket.clone(), json);
        if let Err(error) = comm_manager_tx.send(event) {
            log::error!("{}", error);
        }
    }

}
