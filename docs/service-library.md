<!-- Location: menu-standards-app/content/foundations/service-library.md -->

# Service library

Short service steps tied to particular dishes and drinks. The build matches
these entries to menu items and attaches them to the cards. No AI step ever
writes one, and the checker confirms every service note in a program came
from this file.

This is not service training, which is Restaurant Standards. These are the
few steps that must happen with a specific item, plus a small number of
habits worth reinforcing.

## How to edit

Each entry is a heading followed by five fields. Keep the fields in order.

- **id**: lowercase letters, numbers, and hyphens. Never reuse an id.
- **track**: `food` or `beverage`.
- **level**: `standard` for non-negotiable, `best_practice` for a habit.
- **triggers**: menu words that bring the entry in, separated by commas.
  Matched as whole words against an item's name and description, so
  `oyster` matches "Blue Point oysters" and never "oystercatcher".
- **note**: one or two sentences, 300 characters at most. This is the text
  a server reads.

Two triggers work differently, because the words themselves never appear on
a list of wines. An entry carrying `bottle` or `magnum` attaches to every
item on a wine list menu. The entry `btg-pour-tableside` attaches to every
item on a by-the-glass menu, whatever its text says.

Add entries freely. Change wording to match the property. Remove anything
that does not fit the way you run service. Keep the file at or under 40
entries so the matcher stays predictable.

---

## Raw bar and shellfish

### Seafood fork placed first
- id: raw-bar-fork
- track: food
- level: standard
- triggers: seafood tower, shellfish tower, plateau, raw bar, oyster, oysters, clams, shrimp cocktail
- note: Set a seafood fork and an empty shell bowl before the platter reaches the table, never after.

### Accompaniments arrive with the platter
- id: raw-bar-accompaniments
- track: food
- level: standard
- triggers: seafood tower, shellfish tower, plateau, oyster, oysters, clams
- note: Mignonette, cocktail sauce, horseradish, and lemon reach the table with the platter, not behind it.

### Crackers and picks for whole shellfish
- id: raw-bar-crackers
- track: food
- level: standard
- triggers: lobster, king crab, snow crab, stone crab, whole crab
- note: Place a cracker, pick, and shell bowl before serving, and offer a hot towel or finger bowl afterward.

## Caviar

### Never serve caviar with a metal spoon
- id: caviar-spoon
- track: food
- level: standard
- triggers: caviar, osetra, ossetra, sevruga, kaluga, beluga
- note: Serve with mother of pearl, bone, or horn. Metal changes the taste, so never use a steel spoon.

### Keep caviar on ice at the table
- id: caviar-ice
- track: food
- level: standard
- triggers: caviar, osetra, ossetra, sevruga, kaluga, beluga
- note: Present the tin nested in ice and return it to ice between services. Accompaniments come on their own plate.

## Foie gras

### Accompaniments and bread arrive together
- id: foie-accompaniments
- track: food
- level: standard
- triggers: foie gras, torchon
- note: Toast or brioche and the fruit accompaniment reach the table with the foie gras, and bread goes out warm.

### Offer a sweet wine by the glass
- id: foie-pairing
- track: beverage
- level: best_practice
- triggers: foie gras, torchon
- note: Offer a sweet wine by the glass when the foie gras is ordered, not after the plate is cleared.

## Charcuterie and cheese

### Cheese is served at room temperature
- id: cheese-temperature
- track: food
- level: standard
- triggers: cheese board, cheese plate, cheese course, fromage
- note: Pull cheese from refrigeration well before service. Cold cheese reads flat and firm, and guests notice.

### One knife per cheese
- id: cheese-knife
- track: food
- level: standard
- triggers: cheese board, cheese plate, cheese course
- note: Give every cheese its own knife so no flavor carries from one to the next.

### Name the order of tasting
- id: cheese-order
- track: food
- level: standard
- triggers: cheese board, cheese plate, charcuterie, salumi
- note: Point out where to start and where to finish, moving from mildest to strongest, and name each selection.

## Tableside preparations

### Announce and shield an open flame
- id: tableside-flame
- track: food
- level: standard
- triggers: flambe, flambé, tableside, en croute, bananas foster, steak diane
- note: Tell the table before lighting, keep the flame clear of guests, hair, and linen, and never reach across anyone.

### Clear the space before the cart arrives
- id: tableside-clearance
- track: food
- level: standard
- triggers: tableside, cart, gueridon, carved tableside, prepared tableside
- note: Clear and reset the table before the cart arrives, then serve the moment the preparation is finished.

## Steak and carving

### Steak knife before the plate
- id: steak-knife
- track: food
- level: standard
- triggers: steak, ribeye, rib eye, new york strip, filet mignon, tenderloin, porterhouse, tomahawk, wagyu, chateaubriand
- note: Set the steak knife before the plate lands, blade turned in, so nothing is placed across the guest afterward.

### Sauces on the side unless the kitchen plates them
- id: steak-sauces
- track: food
- level: best_practice
- triggers: steak, ribeye, rib eye, new york strip, filet mignon, tenderloin, porterhouse, tomahawk
- note: Serve sauces on the side unless the kitchen sends them on the plate, and name each one as you set it down.

### Check doneness after the first bite
- id: steak-doneness
- track: food
- level: standard
- triggers: steak, ribeye, rib eye, new york strip, filet mignon, tenderloin, porterhouse, tomahawk
- note: Return shortly after the first bite to confirm the temperature, while it can still be corrected easily.

## Whole fish

### Offer to fillet tableside
- id: whole-fish-fillet
- track: food
- level: standard
- triggers: whole fish, whole branzino, whole dorade, whole snapper, whole sole, dover sole, whole trout, salt baked, salt crusted
- note: Confirm whether the fish arrives filleted or is presented whole, offer to fillet at the table, and set a fish knife and fork before the plate lands.

## Pasta and risotto

### Offer cheese and pepper where the dish calls for it
- id: pasta-cheese-pepper
- track: food
- level: best_practice
- triggers: pasta, risotto, tagliatelle, pappardelle, rigatoni, spaghetti, gnocchi, ravioli, agnolotti
- note: Offer freshly grated cheese and pepper tableside for dishes that call for it, and know which ones do not, such as seafood pasta.

## Sparkling wine

### Open quietly, never with a pop
- id: sparkling-open
- track: beverage
- level: standard
- triggers: champagne, sparkling, cremant, crémant, cava, prosecco, franciacorta, sekt, pet nat
- note: Keep a thumb on the cork, turn the bottle rather than the cork, and finish with a sigh instead of a pop.

### Serve cold, in a tulip or flute
- id: sparkling-temperature
- track: beverage
- level: standard
- triggers: champagne, sparkling, cremant, crémant, cava, prosecco, franciacorta
- note: Serve at about 45 degrees and keep the bottle in ice between pours. A tulip shows aroma better than a narrow flute.

### Pour in two stages
- id: sparkling-pour
- track: beverage
- level: standard
- triggers: champagne, sparkling, cremant, crémant, cava, prosecco
- note: Pour a small amount, let the mousse settle, then fill to about two thirds. It keeps the glass clean and the bubbles fine.

## Still wine

### Wines by the glass are poured at the table
- id: btg-pour-tableside
- track: beverage
- level: standard
- triggers: by the glass, glass pour, btg
- note: Bring the bottle to the table, show the label, and pour the glass in front of the guest. Never pour by-the-glass wine at the bar or the station.

### Present the label before opening
- id: wine-presentation
- track: beverage
- level: standard
- triggers: bottle, magnum
- note: Show the label to whoever ordered it and confirm producer and vintage before the foil is cut.

### Offer the host a taste
- id: wine-host-taste
- track: beverage
- level: standard
- triggers: bottle, magnum
- note: Pour a small taste for the host and wait for approval before serving the table.

### Pour order and pour level
- id: wine-pour-order
- track: beverage
- level: standard
- triggers: bottle, magnum
- note: Pour clockwise from the host's right, host last, and never fill above the widest point of the bowl.

### A fresh glass for a new wine
- id: wine-fresh-glass
- track: beverage
- level: standard
- triggers: bottle, magnum, flight, pairing
- note: Set a clean glass for each new wine and clear the previous one only after the guest has finished with it.

### Serve at the right temperature
- id: wine-temperature
- track: beverage
- level: standard
- triggers: bottle, magnum, chardonnay, sauvignon blanc, pinot noir, cabernet, syrah, sancerre, chablis, riesling
- note: Whites at about 45 to 55 degrees, reds at about 60 to 65. A warm red and an ice cold white both hide the wine.

### Offer to decant
- id: wine-decant
- track: beverage
- level: best_practice
- triggers: barolo, barbaresco, bordeaux, cabernet, nebbiolo, syrah, vintage, reserva, gran reserva
- note: Offer a decant for young tannic reds and for older bottles carrying sediment, and explain why in one sentence.

## Spirits served neat

### Offer water back and ice on the side
- id: spirits-water
- track: beverage
- level: standard
- triggers: neat, whiskey, whisky, bourbon, rye, scotch, mezcal, tequila, agave, rum, cognac, armagnac
- note: Offer still water alongside and ice on the side rather than in the glass, and never add either without asking.

### The glass the guest expects
- id: spirits-glass
- track: beverage
- level: best_practice
- triggers: neat, whiskey, whisky, bourbon, rye, scotch, mezcal, cognac, armagnac, single malt
- note: Use a tasting glass for anything poured neat, and pour in front of the guest when the bottle is worth showing.

## Cocktails

### Garnish is placed as made, and served at once
- id: cocktail-garnish
- track: beverage
- level: standard
- triggers: cocktail, martini, old fashioned, negroni, daiquiri, whiskey sour, pisco sour, amaretto sour, highball, spritz
- note: Serve the cocktail as the bar built it, garnish intact, and carry it out immediately so dilution and chill hold.

### Straws with crushed ice drinks
- id: cocktail-straw
- track: beverage
- level: standard
- triggers: julep, swizzle, crushed ice, tiki, mai tai, mojito
- note: Crushed ice drinks go out with a straw, and a julep goes out with the cup already frosted.

### Name what is in the glass
- id: cocktail-description
- track: beverage
- level: standard
- triggers: cocktail, signature, house cocktail, martini, old fashioned, negroni
- note: Name the spirit and one or two supporting flavors as you set the glass down, using the menu's own words.

## Dessert wine

### Small pour, correct temperature
- id: dessert-wine-pour
- track: beverage
- level: standard
- triggers: sauternes, tokaji, ice wine, eiswein, vin santo, port, madeira, pedro ximenez, moscato d'asti
- note: Pour two to three ounces. Serve sweet whites at about 50 degrees, tawny port lightly chilled, and vintage port at cool room temperature.

### Offer it with the dessert order
- id: dessert-wine-timing
- track: beverage
- level: best_practice
- triggers: sauternes, tokaji, ice wine, vin santo, port, madeira, dessert wine
- note: Offer dessert wine when the dessert is ordered, so both arrive together rather than one chasing the other.

## Coffee and tea

### Espresso is served the moment it is pulled
- id: espresso-timing
- track: beverage
- level: standard
- triggers: espresso, macchiato, cortado, ristretto, americano
- note: Serve espresso in a warmed cup as soon as it is pulled, with the spoon set and sugar on the saucer.

### Time the tea and remove the leaves
- id: tea-steep
- track: beverage
- level: standard
- triggers: green tea, oolong, herbal, tisane, matcha, chamomile
- note: Steep to the time for that tea and remove the leaves at the table, so it does not turn bitter while the guest talks.

### Mark decaf clearly
- id: coffee-decaf
- track: beverage
- level: standard
- triggers: coffee, decaf, drip, french press, cappuccino, latte
- note: Mark decaf so it is never confused at the table, and confirm which cup is which when you set them down.