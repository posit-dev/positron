//
// log.rs
//
// Copyright (C) 2022 by Posit, PBC
//
//

use std::fs::File;
use std::io::prelude::*;
use std::str::FromStr;
use std::sync::Mutex;
use std::sync::Once;
use std::time::SystemTime;

use chrono::DateTime;
use chrono::Utc;
use lazy_static::lazy_static;
use regex::Regex;

lazy_static! {
    static ref RE_ARK_BACKTRACE : Regex = Regex::new("^\\s*\\d+:\\s*[<]?ark::").unwrap();
    static ref RE_BACKTRACE_HEADER : Regex = Regex::new("^\\s*Stack\\s+backtrace:?\\s*$").unwrap();
}

fn annotate(mut message: String) -> String {

    // split into lines
    let mut lines = message.split("\n").collect::<Vec<_>>();

    let mut occurred: Option<String> = None;
    let mut backtrace_index: Option<usize> = None;

    // look for a backtrace entry for ark
    for (index, line) in lines.iter().enumerate() {

        if let Some(_) = RE_BACKTRACE_HEADER.find(line) {
            backtrace_index = Some(index);
            continue;
        }

        if let Some(_) = RE_ARK_BACKTRACE.find(line) {
            occurred = Some(lines[index..=index+1].join("\n"));
            break;
        }

    }

    // if we found the backtrace entry, include it within the log output
    if let Some(occurred) = occurred {
        if let Some(index) = backtrace_index {
            let insertion = ["Occurred at:", occurred.as_str(), ""].join("\n");
            lines.insert(index, insertion.as_str());
            message = lines.join("\n");
        }
    }

    message

}

struct Logger {
    /// The log level (set with the RUST_LOG environment variable)
    level: log::Level,

    /// A mutex to ensure that only one thread is writing to the log file at a
    /// time; None if no log file has been specified (we log to stdout in this
    /// case)
    mutex: Option<Mutex<File>>,
}

impl Logger {

    fn initialize(&mut self, file: Option<&str>) {

        self.mutex = None;

        if let Some(file) = file {

            let file = std::fs::OpenOptions::new()
                .write(true)
                .append(true)
                .create(true)
                .open(file);

            match file {
                Ok(file) => self.mutex = Some(Mutex::new(file)),
                Err(error) => eprintln!("Error initializing log: {}", error),
            }

        }

    }

}

impl log::Log for Logger {

    fn enabled(&self, metadata: &log::Metadata) -> bool {
        metadata.level() as i32 <= self.level as i32
    }

    fn log(&self, record: &log::Record) {

        if !self.enabled(record.metadata()) {
            return;
        }

        // Generate timestamp.
        let now: DateTime<Utc> = SystemTime::now().into();
        let timestamp = now.to_rfc3339_opts(chrono::SecondsFormat::Nanos, true);

        // Generate prefix.
        let prefix = format!(
            "{} [{}-{}] {} {}:{}",
            timestamp,
            "ark",
            "unknown", // TODO: Current user?
            record.level(),
            record.file().unwrap_or("?"),
            record.line().unwrap_or(0),
        );

        // Generate message.
        let message = format!("{}", record.args());

        // Annotate with the error location if a stack trace is available.
        let message = annotate(message);

        // Generate message to log.
        let message = format!("{}: {}", prefix, message);

        if let Some(mutex) = self.mutex.as_ref() {
            // Write to log file if one is specified.
            if let Ok(mut file) = mutex.lock() {
                let status = writeln!(file, "{}", message);
                if let Err(error) = status {
                    eprintln!("Error writing to log file: {}", error);
                }
            }
        } else {
            // If no log file is specified, write to stdout.
            if record.level() == log::Level::Error {
                eprintln!("{}", message);
            } else {
                println!("{}", message);
            }
        }

    }

    fn flush(&self) {
        if let Ok(mut file) = self.mutex.as_ref().unwrap().lock() {
            file.flush().unwrap();
        }
    }

}


pub fn initialize(file: Option<&str>) {

    ONCE.call_once(|| {

        // Initialize the log level, using RUST_LOG.
        log::set_max_level(log::LevelFilter::Info);
        let level = std::env::var("RUST_LOG").unwrap_or("info".into());
        match log::LevelFilter::from_str(level.as_str()) {
            Ok(level) => log::set_max_level(level),
            Err(error) => eprintln!("Error parsing RUST_LOG: {}", error),
        }

        // Set up the logger.
        unsafe {
            LOGGER.initialize(file);
            log::set_logger(&LOGGER).unwrap();
        }

    });

}

static ONCE: Once = Once::new();
static mut LOGGER: Logger = Logger { mutex: None, level: log::Level::Info };
