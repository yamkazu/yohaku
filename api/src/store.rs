//! Store functions return [`AppResult`]. SDK errors (`SdkError`), builder errors
//! (`BuildError`), and timestamp parse errors (`chrono::ParseError`) convert into
//! [`AppError`] through `From`, so store code uses `?`. Failures defined here use
//! `AppError::Other(anyhow::anyhow!(...))`.

use std::collections::HashMap;
use std::env;
use std::future::Future;
use std::time::Duration;

use aws_sdk_dynamodb::error::{BuildError, SdkError};
use aws_sdk_dynamodb::operation::describe_table::DescribeTableError;
use aws_sdk_dynamodb::types::{
    AttributeDefinition, AttributeValue, BillingMode, GlobalSecondaryIndex, KeySchemaElement,
    KeyType, Projection, ProjectionType, ScalarAttributeType, TableStatus,
};
use aws_sdk_dynamodb::Client;
use chrono::{DateTime, Utc};

use crate::error::{AppError, AppResult};
use crate::models::{Article, AuthorSummary};

/// How many times to describe a newly created table before giving up.
const ACTIVE_WAIT_ATTEMPTS: u32 = 40;
/// Pause between describe calls while a new table is being created.
const ACTIVE_WAIT_PAUSE: Duration = Duration::from_millis(100);

pub struct DynamoStore {
    client: Client,
    table: String,
}

impl DynamoStore {
    /// Open a client for the table named by `YOHAKU_TABLE` (`yohaku` when unset).
    ///
    /// # Errors
    ///
    /// Returns an error when AWS configuration cannot be loaded.
    pub async fn connect() -> anyhow::Result<Self> {
        let table = env::var("YOHAKU_TABLE").unwrap_or_else(|_| "yohaku".into());
        Self::connect_with_table(table).await
    }

    /// Open a client for `table`.
    ///
    /// `DYNAMODB_ENDPOINT` or `AWS_ENDPOINT_URL_DYNAMODB`, when set, overrides the
    /// AWS endpoint. Otherwise the default AWS endpoint is used.
    ///
    /// # Errors
    ///
    /// Returns an error when AWS configuration cannot be loaded.
    pub async fn connect_with_table(table: impl Into<String>) -> anyhow::Result<Self> {
        let table = table.into();

        let mut loader = aws_config::defaults(aws_config::BehaviorVersion::latest());
        if let Ok(region) = env::var("AWS_REGION").or_else(|_| env::var("AWS_DEFAULT_REGION")) {
            loader = loader.region(aws_config::Region::new(region));
        } else {
            loader = loader.region(aws_config::Region::new("us-east-1"));
        }

        let shared = loader.load().await;

        // Only override endpoint for explicit local/dev wiring. Omit for real AWS
        // (Lambda/ECS with IAM). Do not fall through to process-wide AWS_ENDPOINT_URL.
        let endpoint = env::var("DYNAMODB_ENDPOINT")
            .or_else(|_| env::var("AWS_ENDPOINT_URL_DYNAMODB"))
            .ok();

        let mut conf = aws_sdk_dynamodb::config::Builder::from(&shared);
        if let Some(ref endpoint) = endpoint {
            conf = conf.endpoint_url(endpoint);
            tracing::info!(%table, %endpoint, "connected to DynamoDB");
        } else {
            tracing::info!(%table, "connected to DynamoDB (default AWS endpoint)");
        }
        let client = Client::from_conf(conf.build());

        Ok(Self { client, table })
    }

    /// Create the table and its slug index when they are missing, then wait until the table is active.
    ///
    /// # Errors
    ///
    /// Returns an error when describing the table fails for a reason other than
    /// the table not existing, when the table cannot be created, or when the table
    /// does not become active before the wait expires.
    pub async fn ensure_schema(&self) -> AppResult<()> {
        let described = self
            .client
            .describe_table()
            .table_name(&self.table)
            .send()
            .await
            .map(|_| ());
        if table_presence(described)? {
            return Ok(());
        }

        tracing::info!(table = %self.table, "creating DynamoDB table");
        self.create_table().await?;
        wait_until_active(&self.table, ACTIVE_WAIT_ATTEMPTS, ACTIVE_WAIT_PAUSE, || {
            self.table_is_active()
        })
        .await
    }

    async fn create_table(&self) -> AppResult<()> {
        self.client
            .create_table()
            .table_name(&self.table)
            .billing_mode(BillingMode::PayPerRequest)
            .attribute_definitions(attr("pk", ScalarAttributeType::S)?)
            .attribute_definitions(attr("sk", ScalarAttributeType::S)?)
            .attribute_definitions(attr("gsi1pk", ScalarAttributeType::S)?)
            .attribute_definitions(attr("gsi1sk", ScalarAttributeType::S)?)
            .key_schema(key("pk", KeyType::Hash)?)
            .key_schema(key("sk", KeyType::Range)?)
            .global_secondary_indexes(
                GlobalSecondaryIndex::builder()
                    .index_name("gsi1")
                    .key_schema(key("gsi1pk", KeyType::Hash)?)
                    .key_schema(key("gsi1sk", KeyType::Range)?)
                    .projection(
                        Projection::builder()
                            .projection_type(ProjectionType::All)
                            .build(),
                    )
                    .build()?,
            )
            .send()
            .await?;
        Ok(())
    }

    async fn table_is_active(&self) -> AppResult<bool> {
        let output = self
            .client
            .describe_table()
            .table_name(&self.table)
            .send()
            .await?;
        Ok(output
            .table
            .and_then(|table| table.table_status)
            .is_some_and(|status| status == TableStatus::Active))
    }

    /// Count stored articles.
    ///
    /// # Errors
    ///
    /// Returns an error when the table scan fails or an item cannot be decoded.
    pub async fn article_count(&self) -> AppResult<usize> {
        Ok(self.list_articles().await?.len())
    }

    /// List articles, newest `published_at` first.
    ///
    /// # Errors
    ///
    /// Returns an error when the table scan fails or an item cannot be decoded.
    pub async fn list_articles(&self) -> AppResult<Vec<Article>> {
        let mut articles = Vec::new();
        let mut start_key = None;

        loop {
            let mut req = self
                .client
                .scan()
                .table_name(&self.table)
                .filter_expression("entity = :entity")
                .expression_attribute_values(":entity", AttributeValue::S("ARTICLE".into()));

            if let Some(key) = start_key.take() {
                req = req.set_exclusive_start_key(Some(key));
            }

            let out = req.send().await?;
            for item in out.items() {
                articles.push(article_from_item(item)?);
            }

            if out.last_evaluated_key().is_none() {
                break;
            }
            start_key = out.last_evaluated_key().cloned();
        }

        articles.sort_by(|a, b| b.published_at.cmp(&a.published_at));
        Ok(articles)
    }

    /// Load the article whose slug index key is `SLUG#{slug}`.
    ///
    /// # Errors
    ///
    /// Returns an error when the query fails or the item cannot be decoded.
    pub async fn get_article_by_slug(&self, slug: &str) -> AppResult<Option<Article>> {
        let out = self
            .client
            .query()
            .table_name(&self.table)
            .index_name("gsi1")
            .key_condition_expression("gsi1pk = :pk")
            .expression_attribute_values(":pk", AttributeValue::S(format!("SLUG#{slug}")))
            .limit(1)
            .send()
            .await?;

        out.items().first().map(article_from_item).transpose()
    }

    /// Insert or replace `article`.
    ///
    /// # Errors
    ///
    /// Returns an error when the write fails.
    pub async fn put_article(&self, article: &Article) -> AppResult<()> {
        self.client
            .put_item()
            .table_name(&self.table)
            .set_item(Some(article_item(article)))
            .send()
            .await?;
        Ok(())
    }
}

fn attr(name: &str, ty: ScalarAttributeType) -> AppResult<AttributeDefinition> {
    Ok(AttributeDefinition::builder()
        .attribute_name(name)
        .attribute_type(ty)
        .build()?)
}

fn key(name: &str, ty: KeyType) -> AppResult<KeySchemaElement> {
    Ok(KeySchemaElement::builder()
        .attribute_name(name)
        .key_type(ty)
        .build()?)
}

fn article_item(article: &Article) -> HashMap<String, AttributeValue> {
    let mut item = HashMap::new();
    item.insert(
        "pk".into(),
        AttributeValue::S(format!("ARTICLE#{}", article.id)),
    );
    item.insert("sk".into(), AttributeValue::S("META".into()));
    item.insert("entity".into(), AttributeValue::S("ARTICLE".into()));
    item.insert("id".into(), AttributeValue::S(article.id.clone()));
    item.insert("slug".into(), AttributeValue::S(article.slug.clone()));
    item.insert("title".into(), AttributeValue::S(article.title.clone()));
    item.insert("excerpt".into(), AttributeValue::S(article.excerpt.clone()));
    item.insert("body".into(), AttributeValue::S(article.body.clone()));
    item.insert(
        "published_at".into(),
        AttributeValue::S(article.published_at.to_rfc3339()),
    );
    item.insert(
        "reading_minutes".into(),
        AttributeValue::N(article.reading_minutes.to_string()),
    );
    item.insert("likes".into(), AttributeValue::N(article.likes.to_string()));
    item.insert(
        "comments".into(),
        AttributeValue::N(article.comments.to_string()),
    );
    // DynamoDB rejects empty string sets (ValidationException).
    if !article.tags.is_empty() {
        item.insert("tags".into(), AttributeValue::Ss(article.tags.clone()));
    }
    item.insert(
        "author_id".into(),
        AttributeValue::S(article.author.id.clone()),
    );
    item.insert(
        "author_name".into(),
        AttributeValue::S(article.author.name.clone()),
    );
    item.insert(
        "author_username".into(),
        AttributeValue::S(article.author.username.clone()),
    );
    item.insert(
        "author_avatar".into(),
        AttributeValue::S(article.author.avatar.clone()),
    );
    item.insert(
        "gsi1pk".into(),
        AttributeValue::S(format!("SLUG#{}", article.slug)),
    );
    item.insert("gsi1sk".into(), AttributeValue::S("ARTICLE".into()));
    item
}

fn article_from_item(item: &HashMap<String, AttributeValue>) -> AppResult<Article> {
    let published_at = DateTime::parse_from_rfc3339(&s(item, "published_at")?)?.with_timezone(&Utc);
    Ok(Article {
        id: s(item, "id")?,
        slug: s(item, "slug")?,
        title: s(item, "title")?,
        excerpt: s(item, "excerpt")?,
        body: s(item, "body")?,
        published_at,
        reading_minutes: n_u32(item, "reading_minutes")?,
        likes: n_u64(item, "likes")?,
        comments: n_u64(item, "comments")?,
        tags: item
            .get("tags")
            .and_then(|v| v.as_ss().ok())
            .cloned()
            .unwrap_or_default(),
        author: AuthorSummary {
            id: s(item, "author_id")?,
            name: s(item, "author_name")?,
            username: s(item, "author_username")?,
            avatar: s(item, "author_avatar")?,
        },
    })
}

fn s(item: &HashMap<String, AttributeValue>, key: &str) -> AppResult<String> {
    item.get(key)
        .and_then(|v| v.as_s().ok())
        .cloned()
        .ok_or_else(|| AppError::Other(anyhow::anyhow!("missing string attr {key}")))
}

fn n_u32(item: &HashMap<String, AttributeValue>, key: &str) -> AppResult<u32> {
    parse_number(item, key)
}

fn n_u64(item: &HashMap<String, AttributeValue>, key: &str) -> AppResult<u64> {
    parse_number(item, key)
}

fn parse_number<T>(item: &HashMap<String, AttributeValue>, key: &str) -> AppResult<T>
where
    T: std::str::FromStr,
    T::Err: std::fmt::Display,
{
    let Some(raw) = item.get(key).and_then(|value| value.as_n().ok()) else {
        return Err(AppError::Other(anyhow::anyhow!(
            "missing number attr {key}"
        )));
    };
    match raw.parse() {
        Ok(number) => Ok(number),
        Err(err) => Err(AppError::Other(anyhow::anyhow!(
            "number attr {key} is out of range: {err}"
        ))),
    }
}

/// Wrap one foreign error as [`AppError::Other`]. Store code uses `?` via the [`From`] impls.
fn app_error_from(err: impl Into<anyhow::Error>) -> AppError {
    AppError::Other(err.into())
}

impl From<BuildError> for AppError {
    fn from(err: BuildError) -> Self {
        app_error_from(err)
    }
}

impl From<chrono::ParseError> for AppError {
    fn from(err: chrono::ParseError) -> Self {
        app_error_from(err)
    }
}

impl<E, R> From<SdkError<E, R>> for AppError
where
    E: std::error::Error + Send + Sync + 'static,
    R: std::fmt::Debug + Send + Sync + 'static,
{
    fn from(err: SdkError<E, R>) -> Self {
        app_error_from(err)
    }
}

/// `Ok(true)` when describe succeeded. `Ok(false)` when the table is missing.
/// Every other describe failure is returned.
fn table_presence<R>(result: Result<(), SdkError<DescribeTableError, R>>) -> AppResult<bool>
where
    R: std::fmt::Debug + Send + Sync + 'static,
{
    match result {
        Ok(()) => Ok(true),
        Err(err) if is_missing_table(&err) => Ok(false),
        Err(err) => Err(err.into()),
    }
}

fn is_missing_table<R>(err: &SdkError<DescribeTableError, R>) -> bool {
    err.as_service_error()
        .is_some_and(describe_error_is_missing_table)
}

/// `ResourceNotFoundException` is the only describe result that means "create the table".
///
/// The SDK asks callers to match `code()` so an `Unhandled` error that still carries
/// that code is treated as a missing table too.
fn describe_error_is_missing_table(err: &DescribeTableError) -> bool {
    err.is_resource_not_found_exception() || err.meta().code() == Some("ResourceNotFoundException")
}

async fn wait_until_active<F, Fut>(
    table: &str,
    attempts: u32,
    pause: Duration,
    mut poll: F,
) -> AppResult<()>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = AppResult<bool>>,
{
    let mut remaining = attempts;
    while remaining > 0 {
        if poll().await? {
            return Ok(());
        }
        remaining -= 1;
        if remaining > 0 && !pause.is_zero() {
            tokio::time::sleep(pause).await;
        }
    }
    Err(AppError::Other(anyhow::anyhow!(
        "DynamoDB table {table} did not become ACTIVE after {attempts} checks"
    )))
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;

    use aws_sdk_dynamodb::error::ErrorMetadata;
    use aws_sdk_dynamodb::types::error::ResourceNotFoundException;
    use chrono::TimeZone;

    use super::*;

    fn service_describe_error(err: DescribeTableError) -> SdkError<DescribeTableError, ()> {
        SdkError::service_error(err, ())
    }

    fn sample_article(tags: Vec<String>) -> Article {
        Article {
            id: "t1".into(),
            slug: "test-slug".into(),
            title: "title".into(),
            excerpt: "excerpt".into(),
            body: "body".into(),
            published_at: Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap(),
            reading_minutes: 1,
            likes: 0,
            comments: 0,
            tags,
            author: AuthorSummary {
                id: "a".into(),
                name: "n".into(),
                username: "u".into(),
                avatar: "AV".into(),
            },
        }
    }

    #[test]
    fn empty_tags_omit_string_set_attribute() {
        // Arrange
        let article = sample_article(vec![]);

        // Act
        let item = article_item(&article);

        // Assert
        assert!(
            !item.contains_key("tags"),
            "DynamoDB rejects empty SS; tags key must be omitted"
        );
    }

    #[test]
    fn non_empty_tags_use_string_set() {
        // Arrange
        let article = sample_article(vec!["frontend".into()]);

        // Act
        let item = article_item(&article);

        // Assert
        let tags = item.get("tags").expect("tags present");
        assert!(tags.as_ss().is_ok());
        assert_eq!(tags.as_ss().unwrap(), &vec!["frontend".to_string()]);
    }

    #[test]
    fn article_item_omits_cover_tone_attribute() {
        // Arrange
        let article = sample_article(vec![]);

        // Act
        let item = article_item(&article);

        // Assert
        assert!(
            !item.contains_key("cover_tone"),
            "cover_tone was removed from the Article contract"
        );
    }

    #[test]
    fn reading_minutes_rejects_values_above_u32() {
        // Arrange
        let article = sample_article(vec![]);
        let mut item = article_item(&article);
        let too_big = u64::from(u32::MAX) + 1;
        item.insert(
            "reading_minutes".into(),
            AttributeValue::N(too_big.to_string()),
        );

        // Act
        let decoded = article_from_item(&item);

        // Assert
        let err = decoded.expect_err("reading_minutes must fit in u32");
        assert!(
            err.to_string().contains("out of range"),
            "out-of-range reading_minutes must be an error, got {err}"
        );
    }

    #[test]
    fn likes_rejects_values_above_u64() {
        // Arrange
        let article = sample_article(vec![]);
        let mut item = article_item(&article);
        let mut too_big = u64::MAX.to_string();
        too_big.push('0');
        item.insert("likes".into(), AttributeValue::N(too_big));

        // Act
        let decoded = article_from_item(&item);

        // Assert
        let err = decoded.expect_err("likes must fit in u64");
        assert!(
            err.to_string().contains("out of range"),
            "out-of-range likes must be an error, got {err}"
        );
    }

    #[test]
    fn reading_minutes_accepts_u32_max() {
        // Arrange
        let article = sample_article(vec![]);
        let mut item = article_item(&article);
        item.insert(
            "reading_minutes".into(),
            AttributeValue::N(u32::MAX.to_string()),
        );

        // Act
        let decoded = article_from_item(&item).expect("u32::MAX fits");

        // Assert
        assert_eq!(decoded.reading_minutes, u32::MAX);
    }

    #[test]
    fn describe_table_not_found_means_the_table_is_absent() {
        // Arrange
        let err = service_describe_error(DescribeTableError::ResourceNotFoundException(
            ResourceNotFoundException::builder()
                .message("Cannot do operations on a non-existent table")
                .meta(
                    ErrorMetadata::builder()
                        .code("ResourceNotFoundException")
                        .message("Cannot do operations on a non-existent table")
                        .build(),
                )
                .build(),
        ));

        // Act
        let present = table_presence(Err(err)).expect("not found is not a failure");

        // Assert
        assert!(!present);
    }

    #[test]
    fn describe_table_unhandled_not_found_code_means_the_table_is_absent() {
        // Arrange
        let err = service_describe_error(DescribeTableError::generic(
            ErrorMetadata::builder()
                .code("ResourceNotFoundException")
                .message("missing")
                .build(),
        ));

        // Act
        let present = table_presence(Err(err)).expect("not found code is not a failure");

        // Assert
        assert!(!present);
    }

    #[test]
    fn describe_table_other_service_error_propagates() {
        // Arrange
        let err = service_describe_error(DescribeTableError::generic(
            ErrorMetadata::builder()
                .code("AccessDeniedException")
                .message("nope")
                .build(),
        ));

        // Act
        let result = table_presence(Err(err));

        // Assert
        let err = result.expect_err("non-not-found describe errors propagate");
        let rendered = format!("{err:#}");
        assert!(
            rendered.contains("AccessDeniedException"),
            "the service code stays on the error chain, got {rendered}"
        );
    }

    #[test]
    fn describe_table_dispatch_failure_propagates() {
        // Arrange
        let err = SdkError::<DescribeTableError, ()>::construction_failure("endpoint config");

        // Act
        let result = table_presence(Err(err));

        // Assert
        let err = result.expect_err("transport failures propagate");
        let rendered = format!("{err:#}");
        assert!(
            rendered.contains("failed to construct request"),
            "construction failure must not be treated as a missing table, got {rendered}"
        );
    }

    #[test]
    fn describe_table_success_means_the_table_is_present() {
        // Arrange
        let described: Result<(), SdkError<DescribeTableError, ()>> = Ok(());

        // Act
        let present = table_presence(described).expect("describe ok");

        // Assert
        assert!(present);
    }

    #[tokio::test]
    async fn wait_until_active_returns_err_when_the_table_never_activates() {
        // Arrange
        let checks = Cell::new(0u32);

        // Act
        let result = wait_until_active("yohaku", 3, Duration::ZERO, || {
            checks.set(checks.get() + 1);
            async { Ok(false) }
        })
        .await;

        // Assert
        let err = result.expect_err("timeout is a failure");
        let message = err.to_string();
        assert!(message.contains("yohaku"), "{message}");
        assert!(message.contains("did not become ACTIVE"), "{message}");
        assert_eq!(checks.get(), 3);
    }

    #[tokio::test]
    async fn wait_until_active_returns_the_poll_error() {
        // Arrange
        let checks = Cell::new(0u32);

        // Act
        let result = wait_until_active("yohaku", 3, Duration::ZERO, || {
            checks.set(checks.get() + 1);
            async { Err(AppError::Other(anyhow::anyhow!("describe failed"))) }
        })
        .await;

        // Assert
        let err = result.expect_err("describe failure");
        assert!(err.to_string().contains("describe failed"), "{err}");
        assert_eq!(checks.get(), 1, "a describe failure stops the wait");
    }

    #[tokio::test]
    async fn wait_until_active_returns_ok_once_a_check_is_active() {
        // Arrange
        let checks = Cell::new(0u32);

        // Act
        let result = wait_until_active("yohaku", 5, Duration::ZERO, || {
            let seen = checks.get();
            checks.set(seen + 1);
            async move { Ok(seen == 1) }
        })
        .await;

        // Assert
        assert!(result.is_ok());
        assert_eq!(checks.get(), 2);
    }

    #[test]
    fn article_roundtrip_preserves_empty_tags_and_slug() {
        // Arrange
        let original = sample_article(vec![]);

        // Act
        let item = article_item(&original);
        let back = article_from_item(&item).expect("decode");

        // Assert
        assert!(back.tags.is_empty());
        assert_eq!(back.slug, original.slug);
        assert_eq!(back.title, original.title);
    }
}
