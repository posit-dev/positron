//
// help_proxy.rs
//
// Copyright (C) 2022 by Posit Software, PBC
//
//

use std::net::Ipv4Addr;
use std::net::SocketAddr;

use http::*;
use http::header::ACCESS_CONTROL_ALLOW_ORIGIN;
use hyper::Body;
use hyper::body::to_bytes;
use hyper::client::conn::handshake;
use hyper::server::conn::Http;
use hyper::service::service_fn;
use tokio::net::TcpListener;
use tokio::net::TcpStream;

async fn handle_request(request: Request<Body>, port: i32) -> anyhow::Result<Response<Body>> {

    let addr = format!("localhost:{}", port);

    log::info!("HELP PROXY: Connecting to {}...", addr);
    let stream = TcpStream::connect(addr.as_str()).await?;
    log::info!("HELP PROXY: Connection to {} established.", addr);

    log::info!("HELP PROXY: Performing handshake...");
    let (mut sender, conn) = handshake(stream).await?;
    log::info!("HELP PROXY: Finished handshake.");

    // spawn a task to poll the connection and drive the HTTP state
    tokio::spawn(async move {
        if let Err(error) = conn.await {
            log::error!("HELP PROXY ERROR: {}", error);
        }
    });

    // send the request
    log::info!("HELP PROXY: Sending request to R help server...");
    let mut response = sender.send_request(request).await?;
    log::info!("HELP PROXY: Received response from R help server.");

    // allow cors
    // TODO: Limit this to some origin that's set by Positron
    response.headers_mut().insert(
        ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("*"));

    // forward the response
    Ok(response)

}

async fn task(port: i32) -> anyhow::Result<()> {

    log::info!("HELP PROXY: Trying to bind to localhost.");
    let addr = SocketAddr::new(std::net::IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1)), 54321);
    let listener = TcpListener::bind(addr).await?;
    log::info!("HELP PROXY: Running at {}", listener.local_addr().unwrap());

    loop {
        let (stream, _) = listener.accept().await?;
        tokio::spawn(async move {

            let status = Http::new()
                .serve_connection(stream, service_fn(|request| async move {
                    handle_request(request, port).await
                }))
                .await;

            if let Err(error) = status {
                log::error!("HELP PROXY ERROR: {}", error);
            }

        });
    }

}

pub fn start(port: i32) {
    log::info!("HELP PROXY: Launching help server task.");
    tokio::spawn(async move { task(port).await });
}

