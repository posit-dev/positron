//
// version.rs
//
// Copyright (C) 2022 Posit Software, PBC. All rights reserved.
//
//

use std::process::Command;

#[allow(dead_code)]
pub struct RVersion {
    // Major version of the R installation
    major: u32,

    // Minor version of the R installation
    minor: u32,

    // Patch version of the R installation
    patch: u32,

    // The full path on disk to the R installation -- that is, the value R_HOME
    // would have inside an R session: > R.home()
    pub r_home: String,
}

pub fn detect_r() -> anyhow::Result<RVersion> {

    let output = Command::new("R")
        .arg("RHOME")
        .output()?;

    // Convert the output to a string
    let r_home = String::from_utf8(output.stdout)?
        .trim()
        .to_string();

    let output = Command::new("R")
        .arg("--vanilla")
        .arg("-s")
        .arg("-e")
        .arg("cat(version$major, \".\", version$minor, sep = \"\")")
        .output()?;

    let version = String::from_utf8(output.stdout)?
        .trim()
        .to_string();

    let version = version.split(".").take(3).map(|x| {
        x.parse::<u32>()
    }).collect::<Result<Vec<u32>, _>>()?;

    // Execute the R script to get the home path to R
    Ok(RVersion{
        major : version[0],
        minor: version[1],
        patch: version[2],
        r_home
    })
}

#[test]
fn test_detect_r() {
    let version = detect_r().unwrap();
    println!("{}.{}.{}", version.major, version.minor, version.patch);
}
