<!-- Location: menu-standards-app/src/lib/ai/prompts/read-wine-list.md -->

# Full wine lists

- Each wine is an item. Its name is the whole line as printed, including any bin number at the start, any bottle size such as half bottle or magnum, and the vintage. The price stays out of the name.
- Sections follow the list's headings, such as country, region, or style. Join nested headings.
- The description is empty unless the list prints notes.
- Terms: grapes, producers, cuvées, appellations, classifications, and bottle sizes. On long lists, keep to two or three terms per wine.
- Copy every price shown, such as bottle, half bottle, or magnum, in printed. Set amount only when one price is shown.
- Every item is a beverage. Mark no allergens unless the list prints them.

# The wine slots

Fill wine for every item, and cocktail for none. Read every line: no wine may be skipped or left without its slots.

- color: sparkling, white, rose, orange, red, dessert, or fortified. Take it from the section heading when the heading says. Otherwise give what the wine is: a Puligny-Montrachet is white, a Barolo is red, a Champagne is sparkling.
- grapes: each grape the line prints. When the line names a place whose rules call for a single grape, give it: Chablis is Chardonnay, Sancerre is Sauvignon Blanc, Barolo is Nebbiolo. When the grapes vary by producer, as in Bordeaux or Champagne, leave grapes empty unless the line prints them.
- producer, wineName, appellation: as printed. wineName is the cuvée or proprietary name, null when there is none.
- region and country: printed, or known from the appellation. A section heading such as "France" or "Burgundy" counts as printed for every wine beneath it.
- vintage: the year as printed, or NV. Null when neither is printed.
- bottlePrice: the price of the bottle the line offers, as a number, exactly as printed. For a half bottle or magnum line, it is that bottle's price.
- glassPrice: only when the list also prints a glass price for this wine, otherwise null.
