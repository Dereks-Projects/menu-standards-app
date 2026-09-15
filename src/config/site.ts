/*
 * Location: menu-standards-app/src/config/site.ts
 *
 * Site-wide settings: product name, contact, navigation, and portfolio
 * links. Components read from this file, so a name or link changes in one
 * place.
 *
 * Navigation rule: a page is added to mainNav only after that page exists,
 * so the menu never links to a missing page.
 */

export type NavLink = {
  readonly label: string;
  readonly href: string;
};

export type PortfolioLink = {
  readonly name: string;
  readonly description: string;
  readonly url: string;
};

export type SiteConfig = {
  readonly name: string;
  readonly description: string;
  readonly contactEmail: string;
  readonly company: {
    readonly name: string;
    readonly url: string;
  };
  /** Pages that show the portfolio menu in the header. */
  readonly marketingPaths: readonly string[];
  readonly mainNav: readonly NavLink[];
  readonly portfolio: readonly PortfolioLink[];
};

export const siteConfig: SiteConfig = {
  name: "Menu Standards",
  description:
    "Menu Standards builds a professional-grade food and beverage education program from a restaurant's own menus.",
  contactEmail: "derek@informativemedia.com",
  company: {
    name: "Informative Media",
    url: "https://informativemedia.com",
  },
  marketingPaths: ["/"],
  mainNav: [{ label: "Home", href: "/" }],
  portfolio: [
    {
      name: "Restaurant Standards",
      description: "Service standards training",
      url: "https://restaurantstandards.com",
    },
    {
      name: "Somm.Site",
      description: "Wine education",
      url: "https://somm.site",
    },
    {
      name: "Beverage.fyi",
      description: "Beverage education",
      url: "https://beverage.fyi",
    },
    {
      name: "Hospitality.fyi",
      description: "Hospitality magazine",
      url: "https://hospitality.fyi",
    },
  ],
};