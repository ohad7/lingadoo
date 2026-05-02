/**
 * Rotating progress messages for the upload progress UI.
 *
 * Three tone pools (calm / playful / silly), four stages each.
 * "Working harder" sub-pools mixed in when the document is flagged as suspicious.
 */

export const STAGES = ['reading', 'preparing', 'translating', 'finishing'];

export const PROGRESS_MESSAGES = {
  calm: {
    reading: [
      'Analyzing your document...',
      'Examining the pages...',
      'Processing the content...',
      'Reviewing the layout...',
      'Scanning through the pages...',
      'Taking a careful look...',
      'Inspecting the details...',
      'Going through every page...',
      'Studying the structure...',
      'Understanding your document...',
    ],
    preparing: [
      'Preparing translation tools...',
      'Loading language resources...',
      'Setting up for translation...',
      'Configuring language support...',
      'Initializing translation...',
      'Preparing the groundwork...',
      'Getting everything in place...',
      'Setting things up...',
      'Assembling language tools...',
      'Almost ready to translate...',
    ],
    translating: [
      'Translating your content...',
      'Working through the pages...',
      'Converting the text...',
      'Processing translations...',
      'Translating page by page...',
      'Rendering the translation...',
      'Moving through the document...',
      'Applying translations...',
      'Working on it...',
      'Progressing steadily...',
    ],
    finishing: [
      'Finalizing the layout...',
      'Preparing your document...',
      'Wrapping up...',
      'Making final adjustments...',
      'Completing the process...',
      'Putting everything together...',
      'Almost done...',
      'Running final checks...',
      'Tidying up...',
      'Just a moment more...',
    ],
  },
  playful: {
    reading: [
      'Squinting at tiny letters...',
      'Reading between the lines...',
      'Hmm, interesting document you\u2019ve got here...',
      'Absorbing the vibes...',
      'Page by page, word by word...',
      'Percolating...',
      'Taking it all in...',
      'Getting to know your document...',
      'Flipping through the pages...',
      'Soaking it all up...',
    ],
    preparing: [
      'Warming up the translation engine...',
      'Getting our dictionaries in order...',
      'Sharpening our pencils...',
      'Stretching before the big run...',
      'Tuning the instruments...',
      'Limbering up for the main event...',
      'Clearing the desk...',
      'Rolling up our sleeves...',
      'Cracking our knuckles...',
      'Deep breath before we dive in...',
    ],
    translating: [
      'Finding le mot juste...',
      'Lost in translation (just kidding)...',
      'Brewing a fresh batch of words...',
      'Mixing languages like a DJ...',
      'Doing the word swap dance...',
      'Playing linguistic Tetris...',
      'One word at a time...',
      'Making the words feel at home...',
      'Building bridges between languages...',
      'Giving your words a new passport...',
    ],
    finishing: [
      'Dotting the i\u2019s, crossing the t\u2019s...',
      'Almost gorgeous...',
      'Putting the finishing touches on...',
      'Making it look sharp...',
      'Smoothing out the wrinkles...',
      'Giving it one last polish...',
      'Nearly there...',
      'Straightening the bow tie...',
      'Adding a cherry on top...',
      'Just making it perfect...',
    ],
  },
  silly: {
    reading: [
      'Teaching robots to read...',
      'Decoding your bureaucratic masterpiece...',
      'Is this a document or modern art?',
      'Your PDF has layers. Like an onion.',
      'Asking the letters to hold still...',
      'Whispering sweet nothings to the pixels...',
      'Making friends with every paragraph...',
      'Your document walked into a bar...',
      'Unfolding origami made of words...',
      'Convincing the font to cooperate...',
    ],
    preparing: [
      'Summoning the polyglot hamsters...',
      'Downloading ALL the words...',
      'Asking Google Translate to leave the room...',
      'Waking up the bilingual elves...',
      'Loading the babel fish...',
      'Dusting off the universal translator...',
      'Feeding the dictionary gremlins...',
      'Plugging in the language crystals...',
      'Polishing our monocle for the task ahead...',
      'Consulting the ancient scrolls of grammar...',
    ],
    translating: [
      'Jizzy jazzing...',
      'Making words do a costume change...',
      'The words are having an identity crisis...',
      'Convincing nouns they\u2019re still nouns...',
      'Herding cats, but the cats are words...',
      'Running the vibes through a prism...',
      'Your words are studying abroad...',
      'Whispering the translations into existence...',
      'The vowels are negotiating with the consonants...',
      'Teaching old words new tricks...',
    ],
    finishing: [
      'Tetris-ing text into place...',
      'Convincing letters to stay in their boxes...',
      'Pixel-pushing with reckless abandon...',
      'Ironing out invisible creases...',
      'Bribing the margins to behave...',
      'The layout gremlins are almost satisfied...',
      'Sprinkling some typographic fairy dust...',
      'Teaching paragraphs to stand in line...',
      'Telling whitespace to mind its own business...',
      'Folding the last origami crane...',
    ],
  },
};

/**
 * Silly messages shown while the upload modal chunk is loading (before
 * processing has started).
 */
export const LOADING_MESSAGES = [
  'Unrolling the welcome mat...',
  'Briefing the pixels...',
  'Ironing the interface...',
  'Convincing the app to wake up...',
  'Loading the loading screen...',
  'Teaching the buttons what they do...',
  'Assembling the furniture...',
  'Warming up the hamster wheel...',
  'Charging the document fairy...',
  'Applying fresh coat of UI...',
  'Syncing with the mothership...',
  'Coaxing the app out of bed...',
];

export const WORKING_HARDER_MESSAGES = {
  calm: [
    'This document requires a closer look...',
    'Taking some extra time to get it right...',
    'A little more care needed here...',
    'Being thorough with this one...',
    'Paying extra attention...',
  ],
  playful: [
    'This one\u2019s a bit tricky \u2014 taking extra care...',
    'Your document is keeping us on our toes...',
    'A challenging one \u2014 we like a challenge...',
    'Going the extra mile for this one...',
    'Nothing a little extra effort can\u2019t solve...',
  ],
  silly: [
    'Your document is putting up a fight...',
    'This PDF thinks it\u2019s a puzzle...',
    'Challenge accepted, document.',
    'We\u2019ve called in reinforcements...',
    'The difficulty slider just went up...',
  ],
};

/**
 * Internal phase name → user-facing stage key.
 */
const PHASE_TO_STAGE = {
  receive_upload: 'reading',
  build_manifest: 'reading',
  extract_layouts: 'reading',
  prepare_web_layouts: 'reading',
  download_language_pack: 'preparing',
  translate_pages: 'translating',
  fit_pages: 'finishing',
  render_outputs: 'finishing',
  create_working_session: 'finishing',
};

/**
 * Map an internal phase name to a user-facing stage key.
 * Falls back to 'reading' for unknown phases.
 */
export function phaseToStage(phase) {
  return PHASE_TO_STAGE[phase] || 'reading';
}

let _lastMessage = '';

/**
 * Pick a random progress message for the given tone and stage.
 * Avoids repeating the immediately previous message.
 *
 * When `workingHarder` is true, the working-harder sub-pool is mixed
 * 50/50 with the normal stage messages.
 */
export function getProgressMessage(tone, stage, workingHarder = false) {
  const resolvedTone = PROGRESS_MESSAGES[tone] ? tone : 'playful';
  const resolvedStage = PROGRESS_MESSAGES[resolvedTone][stage] ? stage : 'reading';
  const stagePool = PROGRESS_MESSAGES[resolvedTone][resolvedStage];

  let pool;
  if (workingHarder && WORKING_HARDER_MESSAGES[resolvedTone]) {
    const harderPool = WORKING_HARDER_MESSAGES[resolvedTone];
    // 50/50 mix: pick from harder pool half the time
    if (Math.random() < 0.5) {
      pool = harderPool;
    } else {
      pool = stagePool;
    }
  } else {
    pool = stagePool;
  }

  // Pick a random message, avoiding the last one
  let pick = pool[Math.floor(Math.random() * pool.length)];
  if (pool.length > 1) {
    let attempts = 0;
    while (pick === _lastMessage && attempts < 5) {
      pick = pool[Math.floor(Math.random() * pool.length)];
      attempts += 1;
    }
  }
  _lastMessage = pick;
  return pick;
}
