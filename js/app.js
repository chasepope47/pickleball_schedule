// Entry point — imports trigger all side-effect registrations
import './theme.js';
import './auth.js';
import './leaderboard.js';
import './easter.js';
import { initGame } from './pickledodge.js';

initGame();
