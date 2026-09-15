/*
 * Location: menu-standards-app/src/components/Header/Header.tsx
 *
 * Site header, shown on every page.
 * - Center: the product name. It always reads "Menu Standards", including
 *   inside a property's program, because the header is platform identity.
 * - Left: the Informative Media portfolio menu, on marketing pages only.
 *   Other pages show an empty space of the same width so the name stays
 *   centered.
 * - Right: the main menu.
 *
 * Accessibility: each menu button tells screen readers whether its panel
 * is open, the Escape key closes an open panel and returns focus to its
 * button, and a click anywhere outside the header closes it.
 */

"use client";

import { ChevronDown, Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { siteConfig } from "@/config/site";

import styles from "./Header.module.css";

type PanelName = "portfolio" | "menu";

type OpenPanel = {
  readonly name: PanelName;
  /** The page the panel was opened on. Moving to another page closes it. */
  readonly pathname: string;
};

export function Header() {
  const pathname = usePathname();
  const [openPanel, setOpenPanel] = useState<OpenPanel | null>(null);

  const headerRef = useRef<HTMLElement>(null);
  const portfolioButtonRef = useRef<HTMLButtonElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  const portfolioPanelId = useId();
  const menuPanelId = useId();

  const activePanel: PanelName | null =
    openPanel !== null && openPanel.pathname === pathname ? openPanel.name : null;

  const showPortfolio = siteConfig.marketingPaths.includes(pathname);

  useEffect(() => {
    if (activePanel === null) {
      return;
    }

    const openButtonRef = activePanel === "portfolio" ? portfolioButtonRef : menuButtonRef;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenPanel(null);
        openButtonRef.current?.focus();
      }
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && headerRef.current?.contains(target)) {
        return;
      }
      setOpenPanel(null);
    }

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [activePanel]);

  function togglePanel(name: PanelName) {
    setOpenPanel((current) => {
      const isOpenHere = current !== null && current.name === name && current.pathname === pathname;
      return isOpenHere ? null : { name, pathname };
    });
  }

  function closePanels() {
    setOpenPanel(null);
  }

  const isPortfolioOpen = activePanel === "portfolio";
  const isMenuOpen = activePanel === "menu";

  return (
    <header ref={headerRef} className={styles.header}>
      <div className={styles.inner}>
        <div className={styles.row}>
          {showPortfolio ? (
            <button
              ref={portfolioButtonRef}
              type="button"
              className={styles.iconButton}
              aria-expanded={isPortfolioOpen}
              aria-controls={portfolioPanelId}
              onClick={() => togglePanel("portfolio")}
            >
              <ChevronDown
                aria-hidden="true"
                size={20}
                className={isPortfolioOpen ? `${styles.chevron} ${styles.chevronOpen}` : styles.chevron}
              />
              <span className="visually-hidden">Informative Media portfolio</span>
            </button>
          ) : (
            <span className={styles.spacer} aria-hidden="true" />
          )}

          <Link href="/" className={styles.title} onClick={closePanels}>
            {siteConfig.name}
          </Link>

          <button
            ref={menuButtonRef}
            type="button"
            className={styles.iconButton}
            aria-expanded={isMenuOpen}
            aria-controls={menuPanelId}
            onClick={() => togglePanel("menu")}
          >
            {isMenuOpen ? <X aria-hidden="true" size={22} /> : <Menu aria-hidden="true" size={22} />}
            <span className="visually-hidden">Main menu</span>
          </button>
        </div>

        {showPortfolio && (
          <nav
            id={portfolioPanelId}
            aria-label="Informative Media portfolio"
            hidden={!isPortfolioOpen}
            className={`${styles.panel} ${styles.panelLeft}`}
          >
            <p className={styles.panelLabel}>Our portfolio</p>
            <ul className={styles.list}>
              {siteConfig.portfolio.map((site) => (
                <li key={site.url}>
                  <a
                    href={site.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.panelLink}
                    onClick={closePanels}
                  >
                    <span className={styles.portfolioName}>{site.name}</span>
                    <span className={styles.portfolioDescription}>{site.description}</span>
                    <span className="visually-hidden"> (opens in a new tab)</span>
                  </a>
                </li>
              ))}
            </ul>
            <hr className={styles.divider} />
            <a
              href={siteConfig.company.url}
              target="_blank"
              rel="noopener noreferrer"
              className={`${styles.panelLink} ${styles.companyLink}`}
              onClick={closePanels}
            >
              {siteConfig.company.name}
              <span className="visually-hidden"> (opens in a new tab)</span>
            </a>
          </nav>
        )}

        <nav
          id={menuPanelId}
          aria-label="Main"
          hidden={!isMenuOpen}
          className={`${styles.panel} ${styles.panelRight}`}
        >
          <ul className={styles.list}>
            {siteConfig.mainNav.map((link) => {
              const isCurrentPage = pathname === link.href;
              return (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className={`${styles.panelLink} ${styles.menuLink}`}
                    aria-current={isCurrentPage ? "page" : undefined}
                    onClick={closePanels}
                  >
                    {link.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </header>
  );
}
