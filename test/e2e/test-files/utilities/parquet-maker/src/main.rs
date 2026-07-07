/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

#![feature(f16)]
use arrow_array::{
    Array, ArrayRef, BooleanArray, Date32Array, Float32Array, Float64Array, Int16Array, Int32Array,
    Int64Array, Int8Array, NullArray, RecordBatch, StringArray, Time32MillisecondArray,
    Time64MicrosecondArray, Time64NanosecondArray, TimestampMicrosecondArray,
    TimestampMillisecondArray, TimestampNanosecondArray, UInt16Array, UInt32Array, UInt64Array,
    UInt8Array,
};
use parquet::{arrow::ArrowWriter, basic::Compression, file::properties::WriterProperties};
use rand::distributions::{Alphanumeric, DistString};
use rand::{thread_rng, Rng};
use std::io::{self};
use std::process;
use std::sync::Arc;
use std::time::UNIX_EPOCH;
use std::{fs::File, time::SystemTime};

// Constants.
const MILLISECONDS_PER_DAY: i32 = 86_400_000;
const MICROSECONDS_PER_DAY: i64 = 86_400_000_000;

// ColumnBatch struct.
struct ColumnBatch {
    name: &'static str,
    values: Arc<dyn Array>,
}

/// Creates a new [`ColumnBatch`] from the provided name and values
impl ColumnBatch {
    /// Create a new [`ColumnBatch`] from the provided name and values
    pub fn new(name: &'static str, values: Arc<dyn Array>) -> Self {
        Self { name, values }
    }
}

// ColumnBatchFactory type.
type ColumnBatchFactory = fn(size: usize) -> ColumnBatch;

fn main() {
    // Prompt the user for the parameters.
    println!("parquet-maker");
    let columns = prompt_for_numeric_value("How many columns?", 1, 1_000_000);
    let batches = prompt_for_numeric_value("How many batches?", 1, 1_000_000);
    let rows_per_batch = prompt_for_numeric_value("How many rows per batch?", 1, 1_000_000);

    // Create the column batch factories.
    let column_batch_factories: Vec<ColumnBatchFactory> = vec![
        //
        // Null.
        //
        |size| ColumnBatch::new("Null", Arc::new(NullArray::new(size as usize)) as ArrayRef),
        //
        // String.
        //
        |size| {
            ColumnBatch::new(
                "String",
                Arc::new(StringArray::from(
                    (0..size)
                        .map(|_| {
                            Alphanumeric.sample_string(
                                &mut rand::thread_rng(),
                                thread_rng().gen_range(1..100),
                            )
                        })
                        .collect::<Vec<String>>(),
                )) as ArrayRef,
            )
        },
        // //
        // // BinaryArray.
        // //
        // |size| {
        //     ColumnBatch::new(
        //         "BinaryArray",
        //         Arc::new(BinaryArray::from_iter_values(
        //             (0..size)
        //                 .map(|_| {
        //                     (0..thread_rng().gen_range(1..100))
        //                         .map(|_| thread_rng().gen_range(128..255))
        //                         .collect::<Vec<u8>>()
        //                 })
        //                 .collect::<Vec<Vec<u8>>>(),
        //         )) as ArrayRef,
        //     )
        // },
        //
        // Bool.
        //
        |size| {
            ColumnBatch::new(
                "Boolean",
                Arc::new(BooleanArray::from(
                    (0..size).map(|_| rand::random()).collect::<Vec<bool>>(),
                )) as ArrayRef,
            )
        },
        //
        // Int8.
        //
        |size| {
            ColumnBatch::new(
                "Int8",
                Arc::new(Int8Array::from(
                    (0..size).map(|_| rand::random()).collect::<Vec<i8>>(),
                )) as ArrayRef,
            )
        },
        //
        // Int16.
        //
        |size| {
            ColumnBatch::new(
                "Int16",
                Arc::new(Int16Array::from(
                    (0..size).map(|_| rand::random()).collect::<Vec<i16>>(),
                )) as ArrayRef,
            )
        },
        //
        // Int32.
        //
        |size| {
            ColumnBatch::new(
                "Int32",
                Arc::new(Int32Array::from(
                    (0..size).map(|_| rand::random()).collect::<Vec<i32>>(),
                )) as ArrayRef,
            )
        },
        //
        // Int64.
        //
        |size| {
            ColumnBatch::new(
                "Int64",
                Arc::new(Int64Array::from(
                    (0..size).map(|_| rand::random()).collect::<Vec<i64>>(),
                )) as ArrayRef,
            )
        },
        //
        // UInt8.
        //
        |size| {
            ColumnBatch::new(
                "UInt8",
                Arc::new(UInt8Array::from(
                    (0..size).map(|_| rand::random()).collect::<Vec<u8>>(),
                )) as ArrayRef,
            )
        },
        //
        // UInt16.
        //
        |size| {
            ColumnBatch::new(
                "UInt16",
                Arc::new(UInt16Array::from(
                    (0..size).map(|_| rand::random()).collect::<Vec<u16>>(),
                )) as ArrayRef,
            )
        },
        //
        // UInt32.
        //
        |size| {
            ColumnBatch::new(
                "UInt32",
                Arc::new(UInt32Array::from(
                    (0..size).map(|_| rand::random()).collect::<Vec<u32>>(),
                )) as ArrayRef,
            )
        },
        //
        // UInt64.
        //
        |size| {
            ColumnBatch::new(
                "UInt64",
                Arc::new(UInt64Array::from(
                    (0..size).map(|_| rand::random()).collect::<Vec<u64>>(),
                )) as ArrayRef,
            )
        },
        //
        // Float32.
        //
        |size| {
            ColumnBatch::new(
                "Float32",
                Arc::new(Float32Array::from(
                    (0..size).map(|_| rand::random()).collect::<Vec<f32>>(),
                )) as ArrayRef,
            )
        },
        //
        // Float64.
        //
        |size| {
            ColumnBatch::new(
                "Float64",
                Arc::new(Float64Array::from(
                    (0..size).map(|_| rand::random()).collect::<Vec<f64>>(),
                )) as ArrayRef,
            )
        },
        //
        // TimestampMillisecond.
        //
        |size| {
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_millis() as i64;
            ColumnBatch::new(
                "TimestampMillisecond",
                Arc::new(
                    TimestampMillisecondArray::from(
                        (0..size)
                            .map(|_| thread_rng().gen_range(-now..now))
                            .collect::<Vec<i64>>(),
                    )
                    .with_timezone_utc(),
                ) as ArrayRef,
            )
        },
        //
        // TimestampMicrosecond.
        //
        |size| {
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_micros() as i64;
            ColumnBatch::new(
                "TimestampMicrosecond",
                Arc::new(
                    TimestampMicrosecondArray::from(
                        (0..size)
                            .map(|_| thread_rng().gen_range(-now..now))
                            .collect::<Vec<i64>>(),
                    )
                    .with_timezone_utc(),
                ) as ArrayRef,
            )
        },
        //
        // TimestampNanosecond.
        //
        |size| {
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos() as i64;
            ColumnBatch::new(
                "TimestampNanosecond",
                Arc::new(
                    TimestampNanosecondArray::from(
                        (0..size)
                            .map(|_| thread_rng().gen_range(-now..now))
                            .collect::<Vec<i64>>(),
                    )
                    .with_timezone_utc(),
                ) as ArrayRef,
            )
        },
        //
        // Date32.
        //
        |size| {
            let now = (SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_secs()
                / 86_400) as i32;
            ColumnBatch::new(
                "Date32",
                Arc::new(Date32Array::from(
                    (0..size)
                        .map(|_| thread_rng().gen_range(-now..now))
                        .collect::<Vec<i32>>(),
                )) as ArrayRef,
            )
        },
        //
        // Date64.
        //
        |size| {
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_millis() as i64;
            ColumnBatch::new(
                "Date64",
                Arc::new(
                    TimestampMillisecondArray::from(
                        (0..size)
                            .map(|_| thread_rng().gen_range(-now..now))
                            .collect::<Vec<i64>>(),
                    )
                    .with_timezone_utc(),
                ) as ArrayRef,
            )
        },
        //
        // Time32Millisecond.
        //
        |size| {
            ColumnBatch::new(
                "Time32Millisecond",
                Arc::new(Time32MillisecondArray::from(
                    (0..size)
                        .map(|_| thread_rng().gen_range(0..MILLISECONDS_PER_DAY))
                        .collect::<Vec<i32>>(),
                )) as ArrayRef,
            )
        },
        //
        // Time32Microsecond.
        //
        |size| {
            ColumnBatch::new(
                "Time64Microsecond",
                Arc::new(Time64MicrosecondArray::from(
                    (0..size)
                        .map(|_| thread_rng().gen_range(0..MICROSECONDS_PER_DAY))
                        .collect::<Vec<i64>>(),
                )) as ArrayRef,
            )
        },
        //
        // Time64Nanosecond.
        //
        |size| {
            ColumnBatch::new(
                "Time64Nanosecond",
                Arc::new(Time64NanosecondArray::from(
                    (0..size)
                        // "ArrowInvalid: Value [nanoseconds] has non-zero nanoseconds" happens when
                        // the nanoseconds are non-zero, so generate microseconds and multiply this
                        // value by 1000.
                        .map(|_| thread_rng().gen_range(0..MICROSECONDS_PER_DAY) * 1_000)
                        .collect::<Vec<i64>>(),
                )) as ArrayRef,
            )
        },
        // //
        // // Decimal128.
        // //
        // |size| {
        //     ColumnBatch::new(
        //         "Decimal128Array",
        //         Arc::new(Decimal128Array::from(
        //             (0..size).map(|_| rand::random()).collect::<Vec<i128>>(),
        //         )) as ArrayRef,
        //     )
        // },
        //
        // These types have been ignored because they are too esoteric:
        // IntervalYearMonth
        // IntervalDayTime
        // IntervalMonthDayNano
        //
        // These types are not supported
        // DurationSecond
        // DurationMillisecond
        // DurationMicrosecond
        // DurationNanosecond
        // They result in an error ArrowError("Converting Duration to parquet not supported").
    ];

    // Create the file.
    let file = File::create("data.parquet").unwrap();

    // Gets a column batch for the specfified column index.
    let get_column_batch = |column: i32| -> (String, Arc<(dyn Array + 'static)>) {
        let column_batch = column_batch_factories[column as usize % column_batch_factories.len()](
            rows_per_batch as usize,
        );
        return (
            format!("column_{}_{}", column, column_batch.name),
            column_batch.values,
        );
    };

    // Gets a record batch
    let get_record_batch = |_| {
        let mut column_batches = Vec::new();
        for n in 0..columns {
            column_batches.push(get_column_batch(n))
        }
        return column_batches;
    };

    // Create the first record batch.
    let mut record_batch =
        RecordBatch::try_from_iter(get_record_batch(&column_batch_factories)).unwrap();

    // Create the writer using the schema from the first record batch.
    let mut writer = ArrowWriter::try_new(
        file,
        record_batch.schema(),
        Some(
            WriterProperties::builder()
                .set_compression(Compression::SNAPPY)
                .build(),
        ),
    )
    .unwrap();

    // Write the batches.
    for batch in 0..batches {
        // Write the batch.
        println!("Write batch {}", batch);
        writer.write(&record_batch).expect("Writing batch");

        // Flush the batch.
        println!("Flush batch {}", batch);
        writer.flush().expect("Flushing batch");

        // Get the next batch, if we're not at the end.
        if batch < batches - 1 {
            println!("Getting next batch");
            record_batch =
                RecordBatch::try_from_iter(get_record_batch(&column_batch_factories)).unwrap();
        }
    }

    // Close writer to write the footer.
    writer.close().unwrap();
}

// Prompts the user for a numeric input.
fn prompt_for_numeric_value(prompt: &str, min: i32, max: i32) -> i32 {
    // Prompt the user.
    println!("\n{}", prompt);

    // Read the input line.
    let mut input_line = String::new();
    io::stdin()
        .read_line(&mut input_line)
        .expect("Failed to read line");

    // Parse the input line.
    let value: i32 = match input_line.trim().parse() {
        Ok(value) => value,
        Err(e) => {
            println!("Error: {}", e);
            process::exit(1);
        }
    };

    // Check the value.
    if value < min || value > max {
        println!("Error: Value must be between {} and {}.", min, max);
        process::exit(1);
    }

    // Return the value.
    return value;
}
