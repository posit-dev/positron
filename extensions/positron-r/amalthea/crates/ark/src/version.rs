// 
// version.rs
// 
// Copyright (C) 2022 by Posit Software, PBC
// 
// 

use std::process::Command;

pub struct RVersion {
    // Major version of the R installation (TODO)
    // major: u32,

    // Minor version of the R installation (TODO)
    // minor: u32,

    // Patch version of the R installation (TODO)
    // patch: u32,

    // The full path on disk to the R installation -- that is, the value R_HOME
    // would have inside an R session: > R.home()
    pub r_home: String,
}

pub fn detect_r() -> RVersion {

    let output = Command::new("R")
        .arg("RHOME")
        .output()
        .expect("Failed to execute R to determine R_HOME");

    // Convert the output to a string
    let output = String::from_utf8(output.stdout)
        .expect("Failed to convert R_HOME output to string")
        .trim()
        .to_string();

    // Execute the R script to get the home path to R
    RVersion{
        r_home: output
    }
}
