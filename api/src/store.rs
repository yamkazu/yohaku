use std::collections::HashMap;
use std::env;

use aws_sdk_dynamodb::types::{
    AttributeDefinition, AttributeValue, BillingMode, GlobalSecondaryIndex, KeySchemaElement,
    KeyType, Projection, ProjectionType, ScalarAttributeType,
};
use aws_sdk_dynamodb::Client;
use chrono::{DateTime, Utc};

use crate::error::{AppError, AppResult};
use crate::models::{Article, AuthorSummary};

pub struct DynamoStore {
    client: Client,
    table: String,
}

impl DynamoStore {
    pub async fn connect() -> anyhow::Result<Self> {
        let table = env::var("YOHAKU_TABLE").unwrap_or_else(|_| "yohaku".into());
        Self::connect_with_table(table).await
    }

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

    pub async fn ensure_schema(&self) -> AppResult<()> {
        if self
            .client
            .describe_table()
            .table_name(&self.table)
            .send()
            .await
            .is_ok()
        {
            return Ok(());
        }

        tracing::info!(table = %self.table, "creating DynamoDB table");

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
                    .build()
                    .map_err(|e| AppError::Other(e.into()))?,
            )
            .send()
            .await
            .map_err(|e| AppError::Other(e.into()))?;

        for _ in 0..40 {
            let active = self
                .client
                .describe_table()
                .table_name(&self.table)
                .send()
                .await
                .ok()
                .and_then(|o| o.table)
                .and_then(|t| t.table_status)
                .map(|s| s.as_str() == "ACTIVE")
                .unwrap_or(false);
            if active {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }

        Ok(())
    }

    pub async fn article_count(&self) -> AppResult<usize> {
        Ok(self.list_articles().await?.len())
    }

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

            let out = req.send().await.map_err(|e| AppError::Other(e.into()))?;
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
            .await
            .map_err(|e| AppError::Other(e.into()))?;

        out.items().first().map(article_from_item).transpose()
    }

    pub async fn put_article(&self, article: &Article) -> AppResult<()> {
        self.client
            .put_item()
            .table_name(&self.table)
            .set_item(Some(article_item(article)))
            .send()
            .await
            .map_err(|e| AppError::Other(e.into()))?;
        Ok(())
    }
}

fn attr(name: &str, ty: ScalarAttributeType) -> AppResult<AttributeDefinition> {
    AttributeDefinition::builder()
        .attribute_name(name)
        .attribute_type(ty)
        .build()
        .map_err(|e| AppError::Other(e.into()))
}

fn key(name: &str, ty: KeyType) -> AppResult<KeySchemaElement> {
    KeySchemaElement::builder()
        .attribute_name(name)
        .key_type(ty)
        .build()
        .map_err(|e| AppError::Other(e.into()))
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
        "cover_tone".into(),
        AttributeValue::S(article.cover_tone.clone()),
    );
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
    Ok(Article {
        id: s(item, "id")?,
        slug: s(item, "slug")?,
        title: s(item, "title")?,
        excerpt: s(item, "excerpt")?,
        body: s(item, "body")?,
        cover_tone: s(item, "cover_tone")?,
        published_at: DateTime::parse_from_rfc3339(&s(item, "published_at")?)
            .map_err(|e| AppError::Other(e.into()))?
            .with_timezone(&Utc),
        reading_minutes: n_u64(item, "reading_minutes")? as u32,
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

fn n_u64(item: &HashMap<String, AttributeValue>, key: &str) -> AppResult<u64> {
    item.get(key)
        .and_then(|v| v.as_n().ok())
        .and_then(|n| n.parse().ok())
        .ok_or_else(|| AppError::Other(anyhow::anyhow!("missing number attr {key}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn sample_article(tags: Vec<String>, cover_tone: &str) -> Article {
        Article {
            id: "t1".into(),
            slug: "test-slug".into(),
            title: "title".into(),
            excerpt: "excerpt".into(),
            body: "body".into(),
            cover_tone: cover_tone.into(),
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
        let article = sample_article(vec![], "mist");

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
        let article = sample_article(vec!["frontend".into()], "mist");

        // Act
        let item = article_item(&article);

        // Assert
        let tags = item.get("tags").expect("tags present");
        assert!(tags.as_ss().is_ok());
        assert_eq!(tags.as_ss().unwrap(), &vec!["frontend".to_string()]);
    }

    #[test]
    fn cover_tone_stored_as_string_attribute() {
        for tone in crate::models::COVER_TONES {
            // Arrange
            let article = sample_article(vec![], tone);

            // Act
            let item = article_item(&article);

            // Assert
            assert_eq!(
                item.get("cover_tone")
                    .and_then(|v| v.as_s().ok())
                    .map(String::as_str),
                Some(*tone)
            );
        }
    }

    #[test]
    fn article_roundtrip_preserves_empty_tags_and_cover_tone() {
        // Arrange
        let original = sample_article(vec![], "sage");

        // Act
        let item = article_item(&original);
        let back = article_from_item(&item).expect("decode");

        // Assert
        assert!(back.tags.is_empty());
        assert_eq!(back.cover_tone, "sage");
        assert_eq!(back.slug, original.slug);
    }
}
