//
// version.rs
//
// Copyright (C) 2022 by Posit Software, PBC
//
//

use std::process::Command;

#[allow(dead_code)]
pub struct RVersion {
    // Major version of the R installation (TODO)
    major: u32,

    // Minor version of the R installation (TODO)
    minor: u32,

    // Patch version of the R installation (TODO)
    patch: u32,

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
    let r_home = String::from_utf8(output.stdout)
        .expect("Failed to convert R_HOME output to string")
        .trim()
        .to_string();

    let output = Command::new("R")
        .arg("-s")
        .arg("-e")
        .arg("cat(version$major, \".\", version$minor, sep = \"\")")
        .output()
        .expect("Failed to execute R to determine version number");

    let version = String::from_utf8(output.stdout)
        .expect("Failed to convert R version number to a string")
        .trim()
        .to_string();

    let mut version = version.split(".");

    let major : u32 = version.next().unwrap().parse().unwrap();
    let minor : u32 = version.next().unwrap().parse().unwrap();
    let patch : u32 = version.next().unwrap().parse().unwrap();

    // Execute the R script to get the home path to R
    RVersion{
        major, minor, patch, r_home
    }
}

#[test]
fn test_detect_r() {
    let version = detect_r();
    println!("{}.{}.{}", version.major, version.minor, version.patch);
}
