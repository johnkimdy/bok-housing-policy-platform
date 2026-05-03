import { NavLink } from "react-router-dom";
import styles from "./TopNav.module.css";

const NAV_ITEMS = [
  { to: "/scenarios",   label: "Scenario Builder" },
  { to: "/projections", label: "Projections" },
  { to: "/briefs",      label: "Policy Briefs" },
  { to: "/advisor",     label: "AI Advisor" },
];

export default function TopNav() {
  return (
    <header className={styles.topnav}>
      {/* Left: identity */}
      <div className={styles.identity}>
        <div className={styles.logoCircle}>韓</div>
        <div className={styles.identityText}>
          <span className={styles.supertitle}>Bank of Korea · 한국은행</span>
          <span className={styles.title}>Seoul Housing Policy Scenario Platform</span>
        </div>
      </div>

      {/* Centre: page tabs */}
      <nav className={styles.tabs}>
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `${styles.tab} ${isActive ? styles.tabActive : ""}`
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      {/* Right: user / quarter */}
      <div className={styles.meta}>jkimdy@bok.or.kr · Q2 2026</div>
    </header>
  );
}
