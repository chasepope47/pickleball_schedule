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
  skunk:        { icon: '🦨', name: 'The Skunk',       desc: 'Won a game 11–0' },
  topDog:       { icon: '👑', name: 'Top Dog',         desc: 'Reached #1 on the leaderboard' },
  teamTopDog:   { icon: '🏆', name: 'Team Champions',  desc: "Your department reached #1 on the team leaderboard" },
  earlyBird:    { icon: '🌅', name: 'Early Bird',      desc: 'Played a match before 8 AM' },
  nightOwl:     { icon: '🦉', name: 'Night Owl',       desc: 'Played a match at or after 8 PM' },
  underdog:     { icon: '🐾', name: 'Underdog',        desc: 'Won a match while your department had a losing record' },
};

export const WAIVER_BODY_HTML = `
  <p class="waiver-title">Play at Your Own Risk</p>
  <p>Use of this facility is at your own risk. Safe Streets is not responsible for any injuries, accidents, or loss of personal property while using this facility.</p>
  <p><strong>Assumption of Risk and Release of Liability</strong></p>
  <p>I acknowledge that participation in activities at the Safe Streets facility involves inherent risks, including the risk of injury. By using this facility, I voluntarily assume all risks associated with participation.</p>
  <p>I hereby release, waive, and discharge Safe Streets, its staff, volunteers, and affiliates from all liability, claims, demands, or causes of action for injuries, damage, or losses that may arise from my use of the facility, whether caused by negligence or otherwise.</p>
  <p>I understand and agree to use the facility at my own risk.</p>
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
