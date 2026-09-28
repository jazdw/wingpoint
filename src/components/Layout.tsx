import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth';

export function Layout() {
  const { user, logout } = useAuth();

  return (
    <div className="app-shell">
      <header className="site-header">
        <NavLink to="/" className="brand">
          <span className="brand-mark">🪽</span>
          <span className="brand-name">WingPoint</span>
        </NavLink>
        <nav className="nav">
          <NavLink to="/" end>
            Games
          </NavLink>
          <NavLink to="/stats">Stats</NavLink>
          <NavLink to="/groups">Groups</NavLink>
        </nav>
        <div className="user-menu">
          <NavLink to="/games/new" className="btn btn-primary btn-sm">
            New game
          </NavLink>
          {user?.picture ? (
            <img className="avatar" src={user.picture} alt="" referrerPolicy="no-referrer" />
          ) : (
            <span className="avatar avatar-fallback">{user?.name?.[0]?.toUpperCase() ?? '?'}</span>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void logout()}>
            Sign out
          </button>
        </div>
      </header>
      <main className="page">
        <Outlet />
      </main>
      <footer className="site-footer">
        <span>WingPoint · not affiliated with Stonemaier Games</span>
      </footer>
    </div>
  );
}
