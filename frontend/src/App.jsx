import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Home from './pages/Home/Home';
import Call from './pages/Home/Call';
import Leaderboard from './pages/Leaderboard/Leaderboard';
import Terms from './pages/Terms/Terms';
import Privacy from './pages/Privacy/Privacy';
import './App.css'

function App() {
    return (
        <Router>
            <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/call/:matchId" element={<Call />} />
                <Route path="/leaderboard" element={<Leaderboard />} />
                <Route path="/terms" element={<Terms />} />
                <Route path="/privacy" element={<Privacy />} />
            </Routes>
        </Router>
    );
}

export default App;
