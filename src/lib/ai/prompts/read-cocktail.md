<!-- Location: menu-standards-app/src/lib/ai/prompts/read-cocktail.md -->

# Cocktail menus

Staff are quizzed on every drink: which cocktails have gin, what bourbon goes in a drink, which is our most expensive cocktail, how a drink is served. Read every drink, and fill its slots.

- Each cocktail is an item. Its ingredient list, as printed, is its description.
- Terms: base spirits and their brands, liqueurs, amari, bitters, syrups and cordials, techniques such as infused or clarified, and the cocktail's name when it is a classic, such as Negroni or Sazerac.
- A signature cocktail's own name is a house term. Ask about it only when a server would need more than its printed ingredients to describe it, or to learn how it is served (see serve, below), and ask once, in one question.
- "Secret recipe" or similar wording is a house term to confirm: ask whether servers may share the full recipe with guests.
- Non-alcoholic drinks on a cocktail menu are beverage items like any other. Keep a "Non-Alcoholic" heading in the section name.
- Allergens: record only what the menu names, such as egg white (eggs) or cream (milk). Orgeat, nut liqueurs, and other ingredients that only a recipe would reveal record nothing.

# The cocktail slots

Fill cocktail for every drink, non-alcoholic ones included, and wine for none.

- spirits: each spirit, liqueur, amaro, vermouth, or wine in the drink, in printed order. category: the plain kind, in lowercase, such as gin, vodka, bourbon, rye, scotch, tequila, mezcal, rum, cognac, amaro, liqueur, vermouth, or sparkling wine. brand: the brand as printed, such as Tanqueray or Woodford Reserve, or null. When the line prints only the brand, give the category it belongs to: Tanqueray is gin, Woodford Reserve is bourbon. Leave spirits empty for a non-alcoholic drink.
- serve: neat, up, rocks, one_rock (a single large rock or cube), collins (tall, over ice), frozen, hot, or other. servePrinted: true when the menu says how the drink is served. For a classic made the classic way, you may give its classic serve with servePrinted false: a Martini is up, a Negroni is rocks. For a signature drink whose serve is not printed, leave serve null and ask the manager under house terms how it is served, offering neat, up, rocks, one rock, or collins.
- glass: as printed, such as coupe or Nick and Nora. Null when not printed.
- garnish: as printed. Null when not printed.
- The price stays in the item's price.
