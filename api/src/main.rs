//! 余白 API — Axum + DynamoDB (Lambda Web Adapter compatible)

use std::net::SocketAddr;

use tracing_subscriber::EnvFilter;
use yohaku_api::{app, build_state};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .with_target(false)
        .compact()
        .init();

    let state = build_state().await?;
    let app = app(state);

    // Lambda Web Adapter sets PORT (default 8080). Local default: 3848.
    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(3848);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!(%addr, "yohaku-api listening");

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}
