import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { GameDetail } from './pages/GameDetail';
import { Login } from './pages/Login';
import { NewGame } from './pages/NewGame';
import { StatsPage } from './pages/Stats';

export default function App() {
  const { loading } = useAuth();

  if (loading) {
    return (
      <div className="splash">
        <div className="brand-mark large">🪽</div>
        <p>Loading WingPoint…</p>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="games/new" element={<NewGame />} />
        <Route path="games/:id" element={<GameDetail />} />
        <Route path="stats" element={<StatsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
