/*
 * Location: menu-standards-app/src/app/layout.tsx
 *
 * Root layout. Wraps every page in the app.
 * - Loads Inter through next/font, which downloads the font when the site
 *   is built and serves it from this site, so visitors never contact Google.
 * - Applies the design tokens and base styles from globals.css. It is
 *   imported before the components so component styles can build on it.
 * - Places the header and footer around every page, with a "Skip to main
 *   content" link that appears when a keyboard user presses Tab.
 * - Sets default page titles.
 * - Keeps every page out of search results until the public landing page
 *   launches. The landing page step turns indexing on for marketing pages.
 */

import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";

import "./globals.css";

import { Footer } from "@/components/Footer/Footer";
import { Header } from "@/components/Header/Header";

import styles from "./layout.module.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: {
    default: "Menu Standards",
    template: "%s | Menu Standards",
  },
  description:
    "Menu Standards builds a professional-grade food and beverage education program from a restaurant's own menus.",
  applicationName: "Menu Standards",
  robots: {
    index: false,
    follow: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#fafafa",
};

type RootLayoutProps = Readonly<{
  children: ReactNode;
}>;

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en" className={inter.variable}>
      <body className={styles.body}>
        <a href="#main-content" className={styles.skipLink}>
          Skip to main content
        </a>
        <Header />
        <main id="main-content" tabIndex={-1} className={styles.main}>
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}