/*
 * main.rs
 *
 * Copyright (C) 2022 by Posit, PBC
 *
 */

mod control;
mod shell;

use crate::control::Control;
use crate::shell::Shell;
use amalthea::connection_file::ConnectionFile;
use amalthea::kernel::Kernel;
use amalthea::kernel_spec::KernelSpec;
use amalthea::socket::iopub::IOPubMessage;
use log::{debug, error, info};
use std::env;
use std::io::stdin;
use std::sync::mpsc::sync_channel;
use std::sync::{Arc, Mutex};

fn start_kernel(connection_file: ConnectionFile) {
    // This channel delivers execution status and other iopub messages from
    // other threads to the iopub thread
    let (iopub_sender, iopub_receiver) = sync_channel::<IOPubMessage>(10);

    let shell_sender = iopub_sender.clone();
    let shell = Arc::new(Mutex::new(Shell::new(shell_sender)));
    let control = Arc::new(Mutex::new(Control {}));

    let kernel = Kernel::new(connection_file);
    match kernel {
        Ok(k) => match k.connect(shell, control, None, iopub_sender, iopub_receiver) {
            Ok(()) => {
                let mut s = String::new();
                println!("Kernel activated, press Ctrl+C to end ");
                if let Err(err) = stdin().read_line(&mut s) {
                    error!("Could not read from stdin: {:?}", err);
                }
            }
            Err(err) => {
                error!("Couldn't connect to front end: {:?}", err);
            }
        },
        Err(err) => {
            error!("Couldn't create kernel: {:?}", err);
        }
    }
}

fn install_kernel_spec() {
    match env::current_exe() {
        Ok(exe_path) => {
            let spec = KernelSpec {
                argv: vec![
                    String::from(exe_path.to_string_lossy()),
                    String::from("--connection_file"),
                    String::from("{connection_file}"),
                ],
                language: String::from("Echo"),
                display_name: String::from("Amalthea Echo"),
                env: serde_json::Map::new()
            };
            if let Err(err) = spec.install(String::from("amalthea")) {
                eprintln!("Failed to install Jupyter kernelspec. {}", err);
            } else {
                println!("Successfully installed Jupyter kernelspec.")
            }
        }
        Err(err) => {
            eprintln!("Failed to determine path to Amalthea. {}", err);
        }
    }
}

fn parse_file(connection_file: &String) {
    match ConnectionFile::from_file(connection_file) {
        Ok(connection) => {
            info!(
                "Loaded connection information from front-end in {}",
                connection_file
            );
            debug!("Connection data: {:?}", connection);
            start_kernel(connection);
        }
        Err(error) => {
            error!(
                "Couldn't read connection file {}: {:?}",
                connection_file, error
            );
        }
    }
}

fn main() {
    // Initialize logging system; the env_logger lets you configure loggign with
    // the RUST_LOG env var
    env_logger::init();

    // Get an iterator over all the command-line arguments
    let mut argv = std::env::args();

    // Skip the first "argument" as it's the path/name to this executable
    argv.next();

    // Process remaining arguments
    match argv.next() {
        Some(arg) => {
            match arg.as_str() {
                "--connection_file" => {
                    if let Some(file) = argv.next() {
                        parse_file(&file);
                    } else {
                        eprintln!("A connection file must be specified with the --connection_file argument.");
                    }
                }
                "--version" => {
                    println!("Amalthea {}", env!("CARGO_PKG_VERSION"));
                }
                "--install" => {
                    install_kernel_spec();
                }
                other => {
                    eprintln!("Argument '{}' unknown", other);
                }
            }
        }
        None => {
            println!("Usage: amalthea --connection_file /path/to/file");
        }
    }
}
