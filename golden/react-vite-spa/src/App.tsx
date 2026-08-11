import { Link, Route, Routes } from 'react-router-dom';

// 최소 SPA — client-routing capability를 실제로 행사한다(2 route + nav).
function Home() {
  return <p>Home 화면입니다.</p>;
}

function About() {
  return <p>About 화면입니다.</p>;
}

export function App() {
  return (
    <main>
      <h1>Golden react-vite-spa</h1>
      <nav aria-label="주요">
        <Link to="/">Home</Link> <Link to="/about">About</Link>
      </nav>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/about" element={<About />} />
      </Routes>
    </main>
  );
}
