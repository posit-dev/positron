/*
 * kernel_spec.rs
 *
 * Copyright (C) 2022 by RStudio, PBC
 *
 */

use crate::error::Error;
use crate::kernel_dirs;
use log::trace;
use serde::Serialize;
use std::fs;
use std::fs::File;
use std::io::Write;
use std::path::PathBuf;
use serde_json::Value;

/// From the Jupyter documentation for [Kernel Specs](https://jupyter-client.readthedocs.io/en/stable/kernels.html#kernel-specs).
#[derive(Serialize)]
pub struct KernelSpec {
    /// List of command line arguments to be used to start the kernel
    pub argv: Vec<String>,

    // The kernel name as it should be displayed in the UI
    pub display_name: String,

    // The kernel's language
    pub language: String,

    // Environment variables to set for the kernel
    pub env: serde_json::Map<String, Value>,
}

impl KernelSpec {
    /// Install a kernel spec to disk.
    pub fn install(&self, folder: String) -> Result<PathBuf, Error> {
        if let Some(kernel_dir) = kernel_dirs::jupyter_kernel_path() {
            return self.install_to(kernel_dir.join(folder));
        }
        return Err(Error::NoInstallDir);
    }

    fn install_to(&self, path: PathBuf) -> Result<PathBuf, Error> {
        // Ensure that the parent folder exists, and form a path to file we'll write
        if let Err(err) = fs::create_dir_all(&path) {
            return Err(Error::CreateDirFailed(err));
        }
        let dest = path.join("kernel.json");

        // Serialize the kernel spec to JSON
        match serde_json::to_string_pretty(self) {
            Ok(contents) => {
                // Install kernelspec to destination
                trace!("Installing kernelspec JSON to {:?}: {}", dest, contents);
                match File::create(&dest) {
                    Ok(mut f) => {
                        if let Err(err) = f.write_all(contents.as_bytes()) {
                            return Err(Error::WriteSpecFailed(err));
                        } else {
                            return Ok(dest);
                        }
                    }
                    Err(err) => return Err(Error::CreateSpecFailed(err)),
                };
            }
            Err(err) => {
                return Err(Error::JsonSerializeSpecFailed(err));
            }
        }
    }
}
