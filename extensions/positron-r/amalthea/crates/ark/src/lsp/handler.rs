//
// handler.rs
//
// Copyright (C) 2022 Posit Software, PBC. All rights reserved.
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
    shell_request_tx: Sender<Request>,
    kernel_init_rx: BusReader<KernelInfo>,
    kernel_initialized: bool,
}

impl Lsp {
    pub fn new(
        shell_request_tx: Sender<Request>,
        kernel_init_rx: BusReader<KernelInfo>
    ) -> Self {
        Self { shell_request_tx, kernel_init_rx, kernel_initialized: false }
    }
}

impl LspHandler for Lsp {
    fn start(&mut self, tcp_address: String) -> Result<(), amalthea::error::Error> {

        let lsp_initialized = self.kernel_initialized;

        // If the kernel hasn't been initialized yet, wait for it to finish.
        // This prevents the LSP from attempting to start up before the kernel
        // is ready; on subsequent starts (reconnects), the kernel will already
        // be initialized.
        if !self.kernel_initialized {
            let status = self.kernel_init_rx.recv();
            if let Err(error) = status {
                log::error!("Error waiting for kernel to initialize: {}", error);
            }
            self.kernel_initialized = true;
        }

        let shell_request_tx = self.shell_request_tx.clone();
        thread::spawn(move || backend::start_lsp(tcp_address, shell_request_tx, lsp_initialized));
        return Ok(());
    }
}
