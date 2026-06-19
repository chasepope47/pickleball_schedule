export const HOURS      = Array.from({ length: 16 }, (_, i) => i + 6); // 6 AM – 9 PM
export const DAY_NAMES  = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
export const DAY_SHORT  = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
export const COURTS     = [1, 2];
export const MAX_PLAYERS = 4;

export const RATINGS = [
  [2.0, '2.0 – Beginner'],
  [2.5, '2.5 – Advanced Beginner'],
  [3.0, '3.0 – Intermediate'],
  [3.5, '3.5 – Advanced Intermediate'],
  [4.0, '4.0 – Advanced'],
  [4.5, '4.5 – Expert'],
  [5.0, '5.0 – Professional'],
];

export const BADGES = {
  'holiday-newyear':     { icon: '🎆', name: "New Year's Day",    desc: "Played on New Year's Day" },
  'holiday-valentine':   { icon: '💝', name: "Valentine's Day",   desc: "Played on Valentine's Day" },
  'holiday-stpatrick':   { icon: '🍀', name: "St. Patrick's Day", desc: "Played on St. Patrick's Day" },
  'holiday-july4':       { icon: '🎇', name: 'Independence Day',  desc: 'Played on Independence Day' },
  'holiday-halloween':   { icon: '🎃', name: 'Halloween',         desc: 'Played on Halloween' },
  'holiday-veterans':    { icon: '🎖️', name: 'Veterans Day',      desc: 'Played on Veterans Day' },
  'holiday-xmaseve':     { icon: '⭐', name: 'Christmas Eve',     desc: 'Played on Christmas Eve' },
  'holiday-xmas':        { icon: '🎄', name: 'Christmas',         desc: 'Played on Christmas Day' },
  'holiday-newyearseve': { icon: '🥂', name: "New Year's Eve",    desc: "Played on New Year's Eve" },
  skunk:     { icon: '🦨', name: 'The Skunk',  desc: 'Won a game 11–0' },
  topDog:    { icon: '👑', name: 'Top Dog',    desc: 'Reached #1 on the leaderboard' },
  earlyBird: { icon: '🌅', name: 'Early Bird', desc: 'Played a match before 8 AM' },
  nightOwl:  { icon: '🦉', name: 'Night Owl',  desc: 'Played a match at or after 8 PM' },
};

export const WAIVER_BODY_HTML = `
  <p class="waiver-title">Waiver &amp; Release of Liability</p>
  <p><strong>Assumption of Risk.</strong> Pickleball is a physical sport. I understand that participation involves inherent risks including, but not limited to, physical exertion, falls, collisions with other players or equipment, muscle strains, joint injuries, and other bodily harm.</p>
  <p><strong>Release of Liability.</strong> I, on behalf of myself, my heirs, and personal representatives, voluntarily release, waive, and discharge SafeStreets, its officers, employees, and agents from any and all liability, claims, or demands arising from my participation in pickleball activities at their facilities.</p>
  <p><strong>Health Acknowledgment.</strong> I confirm I am in adequate physical condition to participate in this activity. I understand it is my responsibility to consult a physician before participating if I have any health concerns.</p>
  <p><strong>Facility Rules.</strong> I agree to follow all facility rules, court etiquette, and instructions of facility staff, and to treat all participants with respect.</p>
  <p>This agreement is effective for all court reservations made through the SafeStreets scheduling system.</p>
`;

export const AUTH_ERRORS = {
  'auth/user-not-found':        'No account found with this email.',
  'auth/wrong-password':        'Incorrect password.',
  'auth/invalid-credential':    'Invalid email or password.',
  'auth/email-already-in-use':  'An account with this email already exists.',
  'auth/weak-password':         'Password must be at least 6 characters.',
  'auth/invalid-email':         'Please enter a valid email address.',
  'auth/too-many-requests':     'Too many attempts. Please try again later.',
  'auth/network-request-failed':'Network error. Check your connection.',
};
