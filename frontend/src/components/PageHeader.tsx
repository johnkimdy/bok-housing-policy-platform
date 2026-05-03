import type { ReactNode } from "react";
import styles from "./PageHeader.module.css";

interface PageHeaderProps {
  icon?: string;
  title: string;
  titleKo: string;
  description: string;
  actions?: ReactNode;
}

export default function PageHeader({ title, titleKo, description, actions }: PageHeaderProps) {
  return (
    <div className={styles.header}>
      <div className={styles.headerLeft}>
        {/* Wireframe style: uppercase caption, then serif display title */}
        <span className={styles.description}>{description}</span>
        <h1 className={styles.title}>
          {titleKo}{" "}
          <span className={styles.titleEn}>{title}</span>
        </h1>
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}
