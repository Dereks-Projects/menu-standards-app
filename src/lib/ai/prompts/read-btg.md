<!-- Location: menu-standards-app/src/lib/ai/prompts/read-btg.md -->

# Wines by the glass

A by-the-glass list is short, and staff are quizzed on every wine on it: which is our most expensive red, what separates our two Chardonnays, who makes our Pinot Noir. Read every line. No wine may be skipped, merged with another, or left without its slots.

- Each wine is an item. Its name is the whole line as printed: grape or blend, producer, cuvée, region, country, and vintage, in the menu's order. The price stays out of the name.
- The description is empty unless the menu prints tasting notes.
- Sections follow the menu's headings, such as Sparkling, White, Rosé, and Red.
- Terms: each grape, producer, cuvée name, region or appellation, and classification, such as Grand Cru or Reserva. "NV" is a style term.
- When both a glass and a bottle price are printed, copy both in printed, such as "16 | 64", and leave amount null.
- Every item is a beverage. Mark no allergens unless the menu prints them.

# The wine slots

Fill wine for every item, and cocktail for none.

- color: sparkling, white, rose, orange, red, dessert, or fortified. Take it from the section heading when the heading says. Otherwise give what the wine is: a Puligny-Montrachet is white, a Barolo is red, a Champagne or Prosecco is sparkling.
- grapes: each grape the line prints. Old World wines are often named by place instead of grape. When the place's rules call for a single grape, give it: Chablis or Puligny-Montrachet is Chardonnay, Sancerre is Sauvignon Blanc, Barolo is Nebbiolo. When the grapes vary by producer, as in Bordeaux, Rioja, or Champagne, leave grapes empty unless the line prints them.
- producer: the winery or house, as printed, such as Joseph Drouhin or Nino Franco.
- wineName: the cuvée or proprietary name, as printed, such as Rustico or Cask 23. Null when there is none. A classification such as Reserva or Brut is a term, not a wine name.
- appellation: the most specific place the line prints, such as Puligny-Montrachet, Valdobbiadene, or Napa Valley.
- region: the wider region, such as Burgundy, Veneto, or Rioja, printed or known from the appellation.
- country: printed, or known from the appellation.
- vintage: the year as printed, or NV when the line prints NV. Null when neither is printed.
- glassPrice: the glass price as a number, exactly as printed. When the line shows several pours, use the standard glass. When the price sits with the section heading, use that number.
- bottlePrice: the bottle price as a number when the line prints one, otherwise null.

Example: the line "Burgundy, Joseph Drouhin, Puligny-Montrachet, 2020, $29" under the heading "White" is color white, grapes Chardonnay, producer Joseph Drouhin, wineName null, appellation Puligny-Montrachet, region Burgundy, country France, vintage 2020, glassPrice 29, bottlePrice null, knownConfidence 0.95.
