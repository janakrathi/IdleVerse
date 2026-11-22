// Matches words in a lyric line to a picture (an icon name from icons.js).
// English, plus common Hindi / Punjabi words in Latin, Devanagari and Gurmukhi script.
(() => {
  const MAP = {
    'heart':          'heart hearts love loving lover lovers loved baby darling dil pyaar pyar ishq mohabbat jaan दिल प्यार इश्क़ इश्क मोहब्बत जान ਦਿਲ ਪਿਆਰ ਇਸ਼ਕ ਜਾਨ',
    'heart-crack':    'heartbreak heartbroken broken break breaking breakup shattered tootna टूटा टूटे ਟੁੱਟਾ ਟੁੱਟੇ',
    'flame':          'fire fires flame flames burn burning burned lit hot heat blaze aag आग ਅੱਗ',
    'moon':           'moon moonlight night nights midnight tonight chand chaand raat चाँद चांद रात ਚੰਨ ਚੰਦ ਰਾਤ',
    'moon-star':      'dream dreams dreaming sleep asleep khwab sapna sapne ख़्वाब ख्वाब सपना सपने ਸੁਪਨਾ ਸੁਪਨੇ ਖ਼ਾਬ',
    'sun':            'sun sunshine sunlight summer daylight morning sooraj dhoop सूरज धूप ਸੂਰਜ ਧੁੱਪ',
    'sunset':         'sunset sunrise dawn dusk horizon evening shaam शाम ਸ਼ਾਮ',
    'star':           'star stars starlight famous superstar sitara taare तारे सितारा ਤਾਰੇ ਤਾਰਾ',
    'sparkles':       'shine shining shiny glow glowing glitter sparkle spark sparks magic gold golden bling light lights',
    'music':          'music song songs sing singing melody radio beat beats rhythm gaana geet गाना गीत ਗੀਤ ਗਾਣਾ',
    'music-2':        'dance dancing dancefloor groove nach naach नाच ਨੱਚ ਨੱਚਦੀ ਨੱਚਣਾ',
    'mic':            'mic microphone voice verse rap rapper',
    'headphones':     'headphones listen listening',
    'car':            'car cars drive driving ride riding whip lambo benz gaddi gaadi गाड़ी ਗੱਡੀ ਗੱਡੀਆਂ',
    'route':          'road roads highway street streets miles journey path raasta rasta रास्ता ਰਾਹ',
    'banknote':       'money cash dollar dollars bands racks paid pay rich bucks paisa paise पैसा पैसे ਪੈਸਾ ਪੈਸੇ',
    'gem':            'diamond diamonds ice jewel jewels chain chains',
    'crown':          'king queen crown royal throne raja rani राजा रानी ਰਾਜਾ ਰਾਣੀ',
    'cloud-rain':     'rain raining rainy storm baarish barish बारिश ਮੀਂਹ',
    'cloud-lightning':'thunder lightning',
    'droplets':       'tears tear cry crying cried drown drowning aansu आँसू आंसू ਹੰਝੂ',
    'zap':            'electric energy shock power charged',
    'waves':          'ocean sea wave waves water river tide beach samundar समंदर ਸਮੁੰਦਰ ਪਾਣੀ',
    'eye':            'eye eyes look looking stare watch watching see aankh aankhein आँख आँखें ਅੱਖ ਅੱਖਾਂ',
    'phone':          'phone call calling calls text texting ring',
    'clock':          'time clock minute minutes hour hours waiting wait waqt samay वक़्त वक्त समय ਵਕਤ ਸਮਾਂ',
    'hourglass':      'forever always someday',
    'infinity':       'infinity endless eternal',
    'plane':          'plane flight airport jet',
    'bird':           'fly flying wings bird birds free freedom',
    'rocket':         'rocket space launch galaxy',
    'house':          'home house ghar घर ਘਰ',
    'key':            'key keys door',
    'lock':           'lock locked',
    'flower':         'flower flowers bloom petals phool फूल ਫੁੱਲ',
    'flower-2':       'rose roses garden gulab गुलाब ਗੁਲਾਬ',
    'camera':         'camera photo photos picture pictures selfie',
    'ghost':          'ghost ghosts haunt haunted',
    'skull':          'dead death die dying kill killer',
    'building-2':     'city cities town downtown skyline shehar शहर ਸ਼ਹਿਰ',
    'globe':          'world earth planet globe duniya दुनिया ਦੁਨੀਆ ਦੁਨੀਆਂ',
    'mountain':       'mountain mountains climb peak top',
    'wine':           'drink drinks drinking drunk wine champagne cheers sharaab daaru शराब दारू ਸ਼ਰਾਬ ਦਾਰੂ',
    'party-popper':   'party celebrate celebration birthday',
    'smile':          'smile smiling happy laugh laughing hasi हँसी ਹਾਸਾ',
    'hand':           'hand hands hold holding touch haath हाथ ਹੱਥ',
    'swords':         'fight fighting war battle enemy enemies',
    'snowflake':      'cold snow freeze frozen winter',
    'cloud':          'cloud clouds sky skies heaven aasmaan आसमान ਅਸਮਾਨ',
    'wind':           'wind breeze blow blowing hawa हवा ਹਵਾ',
    'umbrella':       'umbrella',
    'trees':          'tree trees forest nature',
    'footprints':     'walk walking walked run running steps',
    'coffee':         'coffee',
    'bed':            'bed bedroom',
    'book-open':      'story stories book page',
    'feather':        'feather soft gentle',
    'anchor':         'anchor sail sailing ship',
    'map-pin':        'place somewhere anywhere location'
  };

  const LOOKUP = new Map();
  for (const [icon, words] of Object.entries(MAP)) for (const w of words.split(/\s+/)) LOOKUP.set(w, icon);

  const clean = (w) => w.toLowerCase().normalize('NFC').replace(/^[^\p{L}\p{M}]+|[^\p{L}\p{M}]+$/gu, '').replace(/[’']/g, "'");
  const variants = (w) => [w, w.replace(/'s$/, ''), w.replace(/s$/, ''), w.replace(/in'$/, 'ing'), w.replace(/ing$/, ''), w.replace(/ed$/, '')];

  // Returns { icon, index } for the first word in the line that has a picture, or null.
  function match(words) {
    for (let i = 0; i < words.length; i++) {
      const w = clean(words[i]);
      if (w.length < 2) continue;
      for (const v of variants(w)) if (LOOKUP.has(v)) return { icon: LOOKUP.get(v), index: i };
    }
    return null;
  }

  window.PICTURES = { match };
})();
