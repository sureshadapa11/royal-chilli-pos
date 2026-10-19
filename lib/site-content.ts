// Real copy for the public website, migrated from The-Royal-Chilli/content.json.
// Not DB-backed yet — becomes admin-editable once the Admin Dashboard module is built.

export const siteContent = {
  hero: {
    tag: "Authentic Flavours. Memorable Experiences.",
    headline: "Authentic Indian Flavours.",
    headlineGold: "Made to Be Remembered.",
    description:
      "Discover authentic Hyderabadi, South Indian and North Indian cuisine, from signature dum biryanis and regional curries to dosas, grills and house specialities.",
    bgImages: [
      "/hero/desktop-food-spread.jpg",
      "/hero/desktop-interior.jpg",
      "/hero/desktop-bar.jpg",
      "/hero/desktop-table.jpg",
    ],
    // Separate portrait set for mobile — the desktop photos above are
    // landscape and crop badly full-bleed on a tall phone viewport. Kept in
    // the same theme order as bgImages (food, interior, bar, table) so both
    // rotations open on the same subject.
    mobileBgImages: [
      "/hero/mobile-food-spread.jpg",
      "/hero/mobile-interior.jpg",
      "/hero/mobile-bar.jpg",
      "/hero/mobile-table.jpg",
    ],
  },
  about: {
    title: "Where Every Dish Tells a Story of",
    titleGold: "Passion & Heritage",
    // Short excerpt for the homepage — the full Our Story lives on /about.
    text1:
      "The Royal Chilli is a contemporary Indian restaurant bringing together the bold flavours of Hyderabad, the traditions of South India and the richness of classic North Indian cuisine.",
    text2:
      "From fragrant dum biryanis and regional curries to dosas, tandoori grills, breakfast favourites and modern house specials, our menu is built around authentic recipes, quality ingredients and generous hospitality.",
  },
  ourStory: {
    paragraphs: [
      "The Royal Chilli is a contemporary Indian restaurant bringing together the bold flavours of Hyderabad, the traditions of South India and the richness of classic North Indian cuisine.",
      "From fragrant dum biryanis and regional curries to dosas, tandoori grills, breakfast favourites and modern house specials, our menu is built around authentic recipes, quality ingredients and generous hospitality.",
      "We serve our customers throughout the day with breakfast, lunch, dine-in, takeaway, delivery, catering, private events and bar service, creating a restaurant experience that is accessible, enjoyable and consistently memorable.",
    ],
  },
  mission: {
    statement:
      "To serve authentic, freshly prepared Indian food with consistent quality, generous hospitality and great value, while creating an experience that makes every guest want to return.",
    commitments: ["Great Food", "Consistent Quality", "Genuine Hospitality", "Excellent Value", "Continuous Improvement"],
  },
  vision: {
    statement:
      "To build The Royal Chilli into a trusted and recognised Indian hospitality brand known for authentic regional food, exceptional customer experience and consistently high operating standards.",
    text: "Our long-term vision is to develop a scalable restaurant model that can grow into multiple locations while protecting the taste, quality, service and character that define The Royal Chilli.",
  },
  principles: [
    { title: "Taste Comes First", text: "Every dish must deliver the flavour, freshness and quality our customers expect. Recipes, ingredients and cooking methods are standardised without losing authenticity." },
    { title: "Consistency Every Time", text: "A customer should receive the same quality whether they visit today, next week or at another Royal Chilli location in the future." },
    { title: "Freshness Matters", text: "We believe good food starts with quality ingredients, careful preparation and disciplined kitchen practices." },
    { title: "The Customer Is at the Centre", text: "Every decision — from menus and pricing to service and delivery — is viewed through the customer's experience." },
    { title: "Value Without Compromise", text: "We aim to offer attractive pricing on everyday favourites while delivering premium experiences through our signature and speciality dishes." },
    { title: "Respect the Recipe", text: "Traditional techniques, regional flavours and chef knowledge form the foundation of our food." },
    { title: "Control the Detail", text: "Portion size, presentation, temperature, timing, cleanliness and service all matter." },
    { title: "Improve Every Day", text: "We listen to customers, review performance and continuously improve our food, service and operations." },
  ],
  values: [
    { title: "Authenticity", text: "We respect the heritage and regional character of Indian cuisine and bring genuine flavours to every plate." },
    { title: "Quality", text: "From ingredients and recipes to presentation and service, we do not compromise on standards." },
    { title: "Hospitality", text: "Every customer should feel welcomed, respected and looked after." },
    { title: "Integrity", text: "We aim to be transparent and responsible in the way we work with customers, employees, suppliers and partners." },
    { title: "Teamwork", text: "Great restaurants are created by people working together across the kitchen, front of house and management." },
    { title: "Cleanliness & Safety", text: "Food hygiene, workplace safety and disciplined operating practices are fundamental to our business." },
    { title: "Innovation", text: "We preserve traditional favourites while continuously developing new dishes, promotions and dining experiences." },
    { title: "Community", text: "We want The Royal Chilli to be part of the local community — not simply a place to eat, but a place to meet, celebrate and connect." },
  ],
  foodPhilosophy: {
    tag: "Authentic. Fresh. Consistent.",
    intro:
      "Our food philosophy is simple: start with good ingredients, respect the recipe and cook with care. We combine traditional Indian cooking techniques with disciplined recipe standards so that every dish delivers the flavour and quality expected from The Royal Chilli.",
    focus: ["Fresh preparation", "Standard recipes", "Controlled portions", "Quality ingredients", "Taste checks", "Consistent presentation", "Responsible waste management"],
  },
  differentiators: [
    { title: "Authentic Regional Cuisine", items: ["Hyderabadi", "Rayalaseema", "South Indian", "North Indian"] },
    { title: "All-Day Dining", items: ["Breakfast", "Lunch", "Dinner", "Late Dining"] },
    { title: "Signature Specialities", items: ["Dum Biryanis", "Regional Curries", "Tandoori Grills", "Dosas", "House Specials"] },
    { title: "More Ways to Enjoy The Royal Chilli", items: ["Dine-In", "Takeaway", "Delivery", "Catering", "Private Events"] },
    { title: "Freshly Prepared", text: "Our focus is on fresh preparation, standard recipes, portion control and consistent quality." },
    { title: "Something for Everyone", text: "From affordable breakfast and lunch deals to premium signature dishes and celebration dining." },
  ],
  signatureExperiences: {
    breakfast: { title: "Royal Breakfast", text: "Start the day with South Indian favourites including idli, vada, dosa, poori and our house chutneys and sambar." },
    lunch: { title: "Royal Lunch", text: "Great-value lunch boxes, wraps, biryanis, curries and quick meals designed for a satisfying weekday lunch." },
    dinner: { title: "Royal Dinner", text: "A richer dining experience featuring signature curries, premium grills, biryanis and regional specialities." },
    toGo: { title: "Royal Chilli To Go", text: "Enjoy your favourites through collection, direct ordering and major delivery platforms." },
    catering: { title: "Catering & Events", text: "From family celebrations to corporate catering, community events and private functions, our team can create menus to suit the occasion." },
  },
  ourPromise: {
    tag: "Every Guest. Every Dish. Every Time.",
    items: ["Fresh food", "Consistent taste", "Fair value", "Friendly service", "Clean surroundings", "Accurate orders", "Continuous improvement"],
    closing: "Because at The Royal Chilli, a great meal is not only about what is on the plate — it is about the complete experience.",
  },
  contact: {
    phone: "020 8797 3044",
    // Separate mobile line for WhatsApp click-to-chat — deliberately not the
    // landline above, per explicit instruction to keep both as distinct
    // contact methods rather than merging them.
    waNumber: "447766177108",
    waDisplay: "+44 7766 177108",
    address: "43 Kingsley Road, Hounslow, London, TW3 1PA",
    // Owner, 2026-10-19 — people search "restaurants near Hounslow East station".
    nearby: "3 minutes' walk from Hounslow East station (Piccadilly line)",
    mapEmbed:
      "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2485.593!2d-0.3580133!3d51.4722309!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x48760d00575f94db%3A0x374941cb29fce285!2sThe%20Royal%20Chilli!5e0!3m2!1sen!2suk!4v1718000000000!5m2!1sen!2suk",
    // Same business listing as mapEmbed above (same CID, decoded from its
    // "0x...:0x..." feature id) — opens the verified Google Maps page
    // directly: reviews and directions are both one tap from there.
    googleMapsUrl: "https://www.google.com/maps?cid=3983787686224519813",
    hours: [
      { day: "Monday – Friday", time: "9:00 AM – 12:00 AM" },
      { day: "Saturday – Sunday", time: "8:00 AM – 12:00 AM" },
    ],
    social: {
      instagram: "https://www.instagram.com/the_royal_chilli?igsh=MW12MTVzY2p0ZmUycw==",
    },
  },
  testimonials: [
    { name: "Suresh Patel", platform: "Google Review", stars: 5, text: "Absolutely delicious food, amazing flavours, and excellent service! A must-visit for anyone who loves authentic Indian cuisine. Highly recommended!" },
    { name: "Aditya Sharma", platform: "Google Review", stars: 5, text: "Absolutely incredible food! The Chicken 65 and Biryani are out of this world. You can taste the authenticity in every bite. Best Indian restaurant in London by far!" },
    { name: "Priya Patel", platform: "Google Review", stars: 5, text: "The Royal Dum Biryani is a masterpiece. Warm and attentive service, beautiful ambiance, and food that tasted just like home in Hyderabad. Will be back every week!" },
    { name: "Mohammed Ali", platform: "Google Review", stars: 5, text: "Been coming here for months and it never disappoints. The Butter Chicken and Garlic Naan are simply divine. Staff are always friendly and welcoming — love this place!" },
    { name: "Sarah Johnson", platform: "Google Review", stars: 5, text: "Tried the Chilli Paneer and the Mixed Grill Platter — both phenomenal! The Royal Chilli truly lives up to its name. Highly recommend exploring the Specials menu." },
    { name: "Ravi Kumar", platform: "Google Review", stars: 5, text: "The flavours are genuine and authentic. Spice levels are perfectly balanced. This has become our family's go-to restaurant for every celebration. Absolutely love it!" },
  ],
  reservation: {
    tag: "Reserve a Table",
    title: "Reserve Your",
    titleGold: "Table",
    desc: "Whether it's a date night, family gathering or special celebration — we're here to make it truly memorable.",
  },
  footer: {
    tagline: "Authentic Flavours. Memorable Experiences.",
    copyright: "© 2026 The Royal Chilli. All rights reserved.",
  },
  // These 6 designed promo posters (logo, taglines, callouts baked in) used
  // to lead the /gallery page — moved to their own homepage section instead
  // (right after the hero), and excluded entirely from /gallery now so they
  // don't show up twice (see POPULAR_DISH_FILES there).
  popularDishes: {
    title: "Most Popular Dishes",
    story:
      "From slow-cooked dum biryanis to sizzling tandoori grills, these are the dishes our guests keep coming back for — prepared the traditional way, with real spices and recipes passed down through generations.",
    images: [
      "Where_Hounslow_Meets_Indian_Soul", "Nalli_Gosht_Biryani_Special", "Bheja_Fry_Special",
      "Volcano_Garlic_Prawns", "Chilli_Chicken_Special", "Pistachio_Lamb_Chops",
    ].map(name => `/gallery/${name}.webp`),
  },
  galleryImages: [
    "Royal_Mixed_Platter", "Chicken_Dum_Biryani", "Lamb_Dum_Biryani", "Tandoori_Sizzler",
    "Chicken_Lollipop", "Paneer", "Masala_Dosa", "Haleem",
  ].map(name => `/gallery/${name}.webp`),
};
