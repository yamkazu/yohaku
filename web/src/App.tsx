import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Header } from './components/Header'
import { ArticlePage } from './pages/ArticlePage'
import { HomePage } from './pages/HomePage'

export default function App() {
  return (
    <BrowserRouter>
      <div className="flex min-h-screen flex-col">
        <Header />
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/articles/:slug" element={<ArticlePage />} />
        </Routes>
      </div>
    </BrowserRouter>
  )
}
