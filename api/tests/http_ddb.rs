//! HTTP integration against DynamoDB Local.
//!
//! Requires feature `integration` and a running DynamoDB Local endpoint:
//!   npm run dev:ddb   # or scripts/start-dynamodb.sh
//!   DYNAMODB_ENDPOINT=http://127.0.0.1:8000 cargo test --features integration --locked

use std::sync::Arc;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use serde_json::Value;
use tokio::sync::OnceCell;
use tower::ServiceExt;
use uuid::Uuid;
use yohaku_api::models::Article;
use yohaku_api::seed;
use yohaku_api::store::DynamoStore;
use yohaku_api::{app, AppState};

static APP: OnceCell<axum::Router> = OnceCell::const_new();

fn require_ddb_endpoint() {
    std::env::var("DYNAMODB_ENDPOINT")
        .or_else(|_| std::env::var("AWS_ENDPOINT_URL_DYNAMODB"))
        .expect(
            "integration tests require DYNAMODB_ENDPOINT (start scripts/start-dynamodb.sh first)",
        );
}

fn ensure_local_aws_creds() {
    if std::env::var("AWS_ACCESS_KEY_ID").is_err() {
        // SAFETY: called once before any AWS client is constructed in this process.
        unsafe {
            std::env::set_var("AWS_ACCESS_KEY_ID", "local");
            std::env::set_var("AWS_SECRET_ACCESS_KEY", "local");
        }
    }
    if std::env::var("AWS_REGION").is_err() && std::env::var("AWS_DEFAULT_REGION").is_err() {
        unsafe {
            std::env::set_var("AWS_REGION", "us-east-1");
        }
    }
}

async fn shared_app() -> axum::Router {
    APP.get_or_init(|| async {
        require_ddb_endpoint();
        ensure_local_aws_creds();

        let table = std::env::var("YOHAKU_TABLE")
            .unwrap_or_else(|_| format!("yohaku-it-{}", Uuid::new_v4().simple()));
        let store = DynamoStore::connect_with_table(table)
            .await
            .expect("connect to DynamoDB Local");
        store.ensure_schema().await.expect("ensure_schema");
        seed::seed_if_empty(&store).await.expect("seed");

        app(AppState {
            store: Arc::new(store),
        })
    })
    .await
    .clone()
}

async fn json_get(path: &str) -> (StatusCode, Value) {
    let response = shared_app()
        .await
        .oneshot(
            Request::builder()
                .uri(path)
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");
    let status = response.status();
    let bytes = response
        .into_body()
        .collect()
        .await
        .expect("body")
        .to_bytes();
    let json: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, json)
}

#[tokio::test]
async fn health_ok() {
    // Arrange
    let path = "/health";

    // Act
    let (status, json) = json_get(path).await;

    // Assert
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["status"], "ok");
    assert_eq!(json["service"], "yohaku-api");
    assert_eq!(json["store"], "dynamodb");
}

#[tokio::test]
async fn list_articles_returns_seeded_rows() {
    // Arrange
    let path = "/articles";

    // Act
    let (status, json) = json_get(path).await;

    // Assert
    assert_eq!(status, StatusCode::OK);
    let articles = json.as_array().expect("array");
    assert!(
        articles.len() >= 3,
        "expected seeded articles, got {}",
        articles.len()
    );
    assert!(articles
        .iter()
        .any(|a| a["slug"] == "whitespace-as-product-design"));
}

#[tokio::test]
async fn get_known_slug_returns_article() {
    // Arrange
    let path = "/articles/quiet-apis";

    // Act
    let (status, json) = json_get(path).await;

    // Assert
    assert_eq!(status, StatusCode::OK);
    let article: Article = serde_json::from_value(json).expect("article");
    assert_eq!(article.slug, "quiet-apis");
    assert_eq!(article.cover_tone, "sage");
    assert!(!article.title.is_empty());
    assert!(!article.body.is_empty());
}

#[tokio::test]
async fn unknown_slug_returns_404() {
    // Arrange
    let path = "/articles/does-not-exist-slug";

    // Act
    let (status, json) = json_get(path).await;

    // Assert
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(json["error"], "not found");
}
