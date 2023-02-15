//
// handler.rs
//
// Copyright (C) 2022 by Posit Software, PBC
//
//

use amalthea::language::lsp_handler::LspHandler;
use bus::BusReader;
use crossbeam::channel::Sender;
use std::thread;

use crate::kernel::KernelInfo;
use crate::request::Request;

use super::backend;

pub struct Lsp {
    shell_request_sender: Sender<Request>,
    kernel_init_receiver: BusReader<KernelInfo>,
}

impl Lsp {
    pub fn new(
        shell_request_sender: Sender<Request>,
        kernel_init_receiver: BusReader<KernelInfo>
    ) -> Self {
        Self { shell_request_sender, kernel_init_receiver }
    }
}

impl LspHandler for Lsp {
    fn start(&mut self, tcp_address: String) -> Result<(), amalthea::error::Error> {

        let status = self.kernel_init_receiver.recv();
        if let Err(error) = status {
            log::error!("Error waiting for kernel to initialize: {}", error);
        }

        let sender = self.shell_request_sender.clone();
        thread::spawn(move || backend::start_lsp(tcp_address, sender));
        return Ok(());
    }
}
