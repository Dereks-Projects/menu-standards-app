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
- grapes: each grape the line prints. Old World wines are often named by place instead of grape. Then give the grape a server would name, the way the trade speaks of the wine, even when theory allows more:
  - A single-grape place: Chablis and Puligny-Montrachet are Chardonnay, Sancerre is Sauvignon Blanc, Barolo is Nebbiolo, Brunello di Montalcino is Sangiovese.
  - A blend named by place: its lead grape. Left Bank Bordeaux (Médoc, Haut-Médoc, Pauillac, Margaux, Saint-Julien, Saint-Estèphe, Pessac-Léognan, Graves) is Cabernet Sauvignon. Right Bank Bordeaux (Saint-Émilion, Pomerol, Fronsac) and red Bordeaux with no bank named are Merlot. White Bordeaux is Sauvignon Blanc. Rioja and Ribera del Duero are Tempranillo. Chianti is Sangiovese. Châteauneuf-du-Pape and red Côtes du Rhône are Grenache. Red Northern Rhône, such as Côte-Rôtie, Hermitage, or Crozes-Hermitage, is Syrah.
  - Champagne and other sparkling blends: leave grapes empty unless the line prints them or a style names them: Blanc de Blancs is Chardonnay.
- producer, wineName, appellation: as printed. wineName is the cuvée or proprietary name, null when there is none.
- region and country: printed, or known from the appellation. A section heading such as "France" or "Burgundy" counts as printed for every wine beneath it.
- vintage: the year as printed, or NV. Null when neither is printed.
- bottlePrice: the price of the bottle the line offers, as a number, exactly as printed. For a half bottle or magnum line, it is that bottle's price.
- glassPrice: only when the list also prints a glass price for this wine, otherwise null.
