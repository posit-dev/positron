//
// main.rs
//
// Copyright (C) 2022 by RStudio, PBC
//
//

#![allow(unused_unsafe)]

use crate::control::Control;
use crate::macros::unwrap;
use crate::shell::Shell;
use crate::version::detect_r;
use amalthea::connection_file::ConnectionFile;
use amalthea::kernel::Kernel;
use amalthea::kernel_spec::KernelSpec;
use amalthea::socket::iopub::IOPubMessage;
use log::{debug, error, info};
use std::env;
use std::io::stdin;
use std::sync::mpsc::sync_channel;
use std::sync::{Arc, Mutex};

mod control;
mod interface;
mod kernel;
mod lsp;
mod macros;
mod request;
mod shell;
mod version;

fn start_kernel(connection_file: ConnectionFile) {

    // This channel delivers execution status and other iopub messages from
    // other threads to the iopub thread
    let (iopub_sender, iopub_receiver) = sync_channel::<IOPubMessage>(10);

    let shell_sender = iopub_sender.clone();

    let shell = Shell::new(shell_sender);
    let control = Arc::new(Mutex::new(Control::new(shell.request_sender())));
    let shell = Arc::new(Mutex::new(shell));

    let kernel = Kernel::new(connection_file);
    match kernel {
        Ok(k) => match k.connect(shell, control, iopub_sender, iopub_receiver) {
            Ok(()) => {
                let mut s = String::new();
                println!("R Kernel exiting.");
                if let Err(err) = stdin().read_line(&mut s) {
                    error!("Could not read from stdin: {}", err);
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

// Installs the kernelspec JSON file into one of Jupyter's search paths.
fn install_kernel_spec() {
    // Create the environment set for the kernel spec
    let mut env = serde_json::Map::new();

    // Detect the active version of R and set the R_HOME environment variable
    // accordingly
    let r_version = detect_r();
    env.insert(
        "R_HOME".to_string(),
        serde_json::Value::String(r_version.r_home.clone()),
    );

    // Create the kernelspec
    let exe_path = unwrap!(env::current_exe(), err {
        eprintln!("Failed to determine path to Ark. {}", err);
        return;
    });

    let spec = KernelSpec {
        argv: vec![
            String::from(exe_path.to_string_lossy()),
            String::from("--connection_file"),
            String::from("{connection_file}"),
        ],
        language: String::from("R"),
        display_name: String::from("Amalthea R Kernel (ARK)"),
        env: env,
    };

    let dest = unwrap!(spec.install(String::from("ark")), err {
        eprintln!("Failed to install Ark's Jupyter kernelspec. {}", err);
        return;
    });

    println!(
        "Successfully installed Ark Jupyter kernelspec.

    R:      {}
    Kernel: {}
    ",
        r_version.r_home,
        dest.to_string_lossy()
    );
}

fn parse_file(connection_file: &String) {
    match ConnectionFile::from_file(connection_file) {
        Ok(connection) => {
            info!(
                "Loaded connection information from front end in {}",
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

fn print_usage() {
    println!("Ark {}, the Amalthea R Kernel.", env!("CARGO_PKG_VERSION"));
    println!(r#"
Usage: ark [OPTIONS]

Available options:

--connection_file FILE   Start the kernel with the given JSON connection file
                         (see the Jupyter kernel documentation for details)
--version                Print the version of Ark
--install                Install the kernel spec for Ark
--help                   Print this help message
"#
    );
}

fn main() {

    // Initialize logging system; the env_logger lets you configure logging with
    // the RUST_LOG env var
    env_logger::init();

    // Get an iterator over all the command-line arguments
    let mut argv = std::env::args();

    // Skip the first "argument" as it's the path/name to this executable
    argv.next();

    // Process remaining arguments. TODO: Need an argument that can passthrough args to R
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
                    println!("Ark {}", env!("CARGO_PKG_VERSION"));
                }
                "--install" => {
                    install_kernel_spec();
                }
                "--help" => {
                    print_usage();
                }
                other => {
                    eprintln!("Argument '{}' unknown", other);
                }
            }
        }
        None => {
            // No arguments, print usage and exit
            print_usage();
        }
    }
}
