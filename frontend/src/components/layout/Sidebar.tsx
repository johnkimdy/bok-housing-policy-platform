import { NavLink } from "react-router-dom";
import styles from "./Sidebar.module.css";

const NAV_ITEMS = [
  { to: "/scenarios", label: "시나리오", labelEn: "Scenario Builder" },
  { to: "/projections", label: "전망 분석", labelEn: "Projections" },
  { to: "/briefs", label: "정책 보고서", labelEn: "Policy Briefs" },
  { to: "/advisor", label: "AI 어드바이저", labelEn: "AI Advisor" },
];

export default function Sidebar() {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.logo}>
        <div className={styles.logoIcon}>韓</div>
        <div className={styles.logoText}>
          <span className={styles.logoTitle}>Bank of Korea · 한국은행</span>
          <span className={styles.logoSubtitle}>Seoul Housing Policy Platform</span>
        </div>
      </div>

      <nav className={styles.nav}>
        <div className={styles.navSection}>
          <span className={styles.navSectionLabel}>분석 도구</span>
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `${styles.navItem} ${isActive ? styles.navItemActive : ""}`
              }
            >
              <div className={styles.navLabel}>
                <span className={styles.navLabelKo}>{item.label}</span>
                <span className={styles.navLabelEn}>{item.labelEn}</span>
              </div>
            </NavLink>
          ))}
        </div>
      </nav>

      <div className={styles.footer}>
        <div className={styles.footerText}>
          jkimdy@bok.or.kr · Q2 2026
        </div>
      </div>
    </aside>
  );
}
