import { useEffect, useState } from 'react'
import { ArticleRow } from '../components/ArticleRow'
import { fetchArticles, type Article } from '../lib/api'

export function HomePage() {
  const [articles, setArticles] = useState<Article[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchArticles()
      .then((data) => {
        if (!cancelled) setArticles(data)
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <main className="mx-auto w-full max-w-3xl px-5 pb-24 pt-10 sm:px-6 sm:pt-14">
      <section className="animate-soft mb-10">
        <p className="text-sm tracking-wide text-accent">Tech writing</p>
        <h1 className="mt-2 font-serif text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          余白
        </h1>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-muted sm:text-base">
          note の静けさと、Dev.to の技術の熱。読むためのフィード。
        </p>
      </section>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          記事を取得できませんでした。API と DynamoDB Local が起動しているか確認してください。
          <pre className="mt-2 overflow-x-auto text-xs opacity-80">{error}</pre>
        </div>
      )}

      {!error && articles === null && (
        <div className="animate-soft space-y-8 py-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-sm bg-line/60" />
          ))}
        </div>
      )}

      {articles && articles.length === 0 && (
        <p className="text-sm text-muted">まだ記事がありません。</p>
      )}

      {articles && articles.length > 0 && (
        <div>
          {articles.map((article, index) => (
            <ArticleRow key={article.id} article={article} index={index} />
          ))}
        </div>
      )}
    </main>
  )
}
