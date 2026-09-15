/*
 * Location: menu-standards-app/src/components/Footer/Footer.tsx
 *
 * Site footer, shown on every page. The footer is platform identity: it
 * always names Menu Standards and Informative Media, never a property.
 * Names and links come from src/config/site.ts.
 */

import Link from "next/link";

import { siteConfig } from "@/config/site";

import styles from "./Footer.module.css";

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div>
          <Link href="/" className={styles.brandName}>
            {siteConfig.name}
          </Link>
          <p className={styles.brandDescription}>{siteConfig.description}</p>
        </div>

        <nav aria-labelledby="footer-product-heading">
          <h2 id="footer-product-heading" className={styles.columnTitle}>
            Product
          </h2>
          <ul className={styles.list}>
            {siteConfig.mainNav.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className={styles.link}>
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div>
          <h2 className={styles.columnTitle}>Company</h2>
          <ul className={styles.list}>
            <li>
              <a
                href={siteConfig.company.url}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.link}
              >
                {siteConfig.company.name}
                <span className="visually-hidden"> (opens in a new tab)</span>
              </a>
            </li>
            <li>
              <a href={`mailto:${siteConfig.contactEmail}`} className={styles.link}>
                Contact
              </a>
            </li>
          </ul>
        </div>
      </div>

      <p className={styles.bottom}>
        &copy; {year} {siteConfig.name}, an {siteConfig.company.name} company.
      </p>
    </footer>
  );
}
