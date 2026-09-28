import { Link } from 'react-router-dom'

export function Header() {
  return (
    <header className="sticky top-0 z-20 border-b border-line/80 bg-paper/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-5 sm:h-16 sm:px-6">
        <Link to="/" className="group flex items-baseline gap-2">
          <span className="font-serif text-2xl font-semibold tracking-tight text-ink transition-colors group-hover:text-accent sm:text-[1.75rem]">
            余白
          </span>
          <span className="hidden text-xs text-muted sm:inline">yohaku</span>
        </Link>
        <p className="text-xs text-muted sm:text-sm">技術を、余白とともに</p>
      </div>
    </header>
  )
}
