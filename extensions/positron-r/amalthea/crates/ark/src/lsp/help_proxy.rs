//
// help_proxy.rs
//
// Copyright (C) 2022 Posit Software, PBC. All rights reserved.
//
//

use std::net::Ipv4Addr;
use std::net::SocketAddr;

use http::*;
use hyper::client::conn::handshake;
use hyper::server::conn::Http;
use hyper::service::service_fn;
use hyper::Body;
use stdext::spawn;
use tokio::net::TcpListener;
use tokio::net::TcpStream;

use crate::lsp::browser;

async fn handle_request(
    request: Request<Body>,
    port: i32,
) -> anyhow::Result<Response<Body>> {
    // connect to R help server
    let addr = format!("localhost:{}", port);
    let stream = TcpStream::connect(addr.as_str()).await?;
    let (mut sender, conn) = handshake(stream).await?;

    // spawn a task to poll the connection and drive the HTTP state
    tokio::spawn(async move {
        if let Err(error) = conn.await {
            log::error!("HELP PROXY ERROR: {}", error);
        }
    });

    // send the request
    let response = sender.send_request(request).await?;

    // forward the response
    Ok(response)
}

#[tokio::main]
async fn task(port: i32) -> anyhow::Result<()> {
    let addr = SocketAddr::new(std::net::IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1)), 0);
    let listener = TcpListener::bind(addr).await?;

    if let Ok(addr) = listener.local_addr() {
        let port = addr.port();
        log::info!("Help proxy listening on port {}", port);
        unsafe { browser::PORT = port };
    }

    loop {
        let (stream, _) = listener.accept().await?;
        tokio::spawn(async move {
            let http = Http::new();
            let status = http.serve_connection(
                stream,
                service_fn(|request| async move { handle_request(request, port).await }),
            );

            if let Err(error) = status.await {
                log::error!("HELP PROXY ERROR: {}", error);
            }
        });
    }
}

pub fn start(port: i32) {
    spawn!("ark-help-proxy", move || {
        match task(port) {
            Ok(value) => log::info!("Help proxy server exited with value {:?}", value),
            Err(error) => log::error!("Help proxy server exited unexpectedly: {}", error),
        }
    });
}
