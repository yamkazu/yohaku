import { mkdir } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'

// verify.sh copies these into .verify/screenshots/ when e2e passes.
async function saveEvidence(page: Page, name: string) {
  await mkdir('test-results/evidence', { recursive: true })
  await page.screenshot({
    path: `test-results/evidence/${name}.png`,
    fullPage: true,
    animations: 'disabled',
  })
}

test.describe('user harness: feed → article', () => {
  test('home lists seeded articles and opens article detail', async ({ page }) => {
    // Arrange
    const articleTitle = '余白は機能である——読みやすさを設計するフロントエンド'
    const articleSlug = 'whitespace-as-product-design'

    // Act
    await page.goto('/')

    // Assert — feed shows brand + at least one article row
    await expect(page.getByRole('heading', { level: 1, name: '余白' })).toBeVisible()
    const articleLink = page.getByRole('link', { name: new RegExp(articleTitle) })
    await expect(articleLink).toBeVisible()
    await expect(page.getByText('Deploy smoke canary')).toHaveCount(0)
    await saveEvidence(page, 'article-list')

    // Act — open the article
    await articleLink.click()

    // Assert — detail route and main content
    await expect(page).toHaveURL(new RegExp(`/articles/${articleSlug}$`))
    await expect(
      page.getByRole('heading', { level: 1, name: articleTitle }),
    ).toBeVisible()
    await expect(page.getByText(/視線の導線/)).toBeVisible()
    await saveEvidence(page, 'article-detail')
  })

  test('unknown slug shows not-found state', async ({ page }) => {
    // Arrange
    const missingSlug = 'does-not-exist-slug'

    // Act
    await page.goto(`/articles/${missingSlug}`)

    // Assert
    await expect(page.getByText('記事が見つかりませんでした。')).toBeVisible()
    await expect(page.getByRole('link', { name: /フィードに戻る/ })).toBeVisible()
    await saveEvidence(page, 'not-found')
  })
})
