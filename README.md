# SafeStreets Pickleball Schedule

Internal court reservation and competitive tracking platform for SafeStreets employees. Built as a single-page web app on Firebase Hosting with Firestore as the database.

**Live site:** https://pickleballscheduless.web.app

---

## Table of Contents

- [Overview](#overview)
- [Authentication & Onboarding](#authentication--onboarding)
- [Court Reservations](#court-reservations)
- [Match Logging & Stats](#match-logging--stats)
- [Leaderboard](#leaderboard)
- [Department Standings](#department-standings)
- [Court Conquest](#court-conquest)
- [Rivalry Week](#rivalry-week)
- [Tournaments](#tournaments)
- [Admin Panel](#admin-panel)
- [Badges & Achievements](#badges--achievements)
- [Mini-Games & Easter Eggs](#mini-games--easter-eggs)
- [Active Status (Presence)](#active-status-presence)
- [Roles & Permissions](#roles--permissions)
- [Tech Stack](#tech-stack)

---

## Overview

SafeStreets Pickleball Schedule lets employees reserve time on two indoor pickleball courts, log match results, track personal and department standings, compete in Rivalry Weeks, and earn badges — all from a dark-themed, mobile-friendly web interface.

---

## Authentication & Onboarding

- **Email/password sign-in** — accounts are created by staff only; no self-registration
- **Forced onboarding flow** — new users must complete two steps before accessing the app:
  1. **Sign the waiver** — electronic signature captured and timestamped in Firestore
  2. **Change weak password** — accounts using `pickleball` or `pickleball1` as their password are automatically flagged and forced to set a new one
- **Forgot password** — sends a Firebase password-reset email
- **Login screen isolation** — the court schedule is fully hidden behind the login overlay until the user signs in
- **Blocked accounts** — suspended users are immediately signed out with a message to contact management

---

## Court Reservations

- **Two courts** (Court 1 and Court 2) displayed side-by-side in a responsive grid
- **Weekly view** — navigate between weeks using day tabs (Mon–Sun); resets every Monday
- **Time slots** — bookable from 6 AM to 6 PM (outside these hours are locked for regular users)
- **Staff override** — admins, managers, and system admins can reserve any time slot, including before 6 AM and after 6 PM
- **Slot states:**
  - 🟦 **Open** — empty, available to join (animated pulse)
  - 🟦 **Joinable** — has players, still has open spots
  - 🟠 **Mine** — you are in this slot
  - ⬜ **Full** — no spots remaining
  - 🔒 **Restricted** — outside allowed hours (non-staff)
  - ⬛ **Past** — slot is in the past
- **Manage slot modal** — view who's booked, join or leave a slot, add or remove other players (staff only), log a match result
- **Share slot** — copies a deep-link URL so someone can open the app and join a specific slot directly
- **Player chips** — each booked slot shows name chips for all players; your own chip is highlighted
- **Slot capacity** — configurable per slot; shows "X spots free" in the court header
- **Privilege-based removal** — managers can remove users, admins can remove managers, system admins can remove anyone

---

## Match Logging & Stats

- **Friendly or Competitive** — choose match type when logging a result from a past slot
- **Score entry** — enter scores for 1–5 games per session (e.g., 11–7, 8–11, 11–9)
- **Win/Loss outcome** — choosing Competitive updates your W/L record and rating
- **Rating system** — a simple Elo-style rating that adjusts after every competitive match
- **Opponent rating** — rate other players in your slot with 👍 or 👎 after the match
- **Match notes** — optional free-text comment on each logged match
- **Edit past matches** — correct the result, score, or type of a logged match; stats adjust accordingly
- **Department stats** — each player's wins/losses roll up into their department's standing

---

## Leaderboard

- Accessible to all users via the 🏆 button in the header
- Sorted by wins (ties broken by rating)
- Shows rank (🥇🥈🥉 for top 3), avatar/initials, name, star rating, W/L record, and win percentage
- Displays earned **badges** (up to 3 shown as icons)
- Displays active **win streaks** (🔥 with streak count)
- Shows **online presence dot** (green) for users currently on the page

---

## Department Standings

Visible in the left sidebar to all users with a department assignment (and to all staff regardless).

- Sorted by total department wins
- Shows rank medal, department icon and name, member count, W/L record, and win percentage
- **Triple-click a department name** to reveal its hidden mascot (Easter egg — see below)
- Departments in an active Rivalry Week show an ⚔️ pin
- Departments that have won past Rivalry Weeks show a permanent 🏆 victory banner
- Clicking any department opens a **detail modal** with a roster of members and their individual stats

---

## Court Conquest

Displayed automatically above the Department Standings each month.

- Tracks which department has the most **competitive wins** on each individual court this calendar month
- Resets at the start of each new month
- Shows "🏓 Court 1: 🛡️ Care (8 captures)" or "Tied!" when two departments are equal
- Pulls live from Firestore match history — no manual tracking required

---

## Rivalry Week

Configured by admins in the Admin Panel → ⚔️ Rivalry tab.

- **Create a rivalry** — select two departments, give it a title (e.g., "July Rivalry Week"), and set start and end dates
- **Live scoreboard** — appears at the top of the Department Standings sidebar; updates in real time as competitive matches are logged
- **Leading department** is highlighted in the scoreboard
- **Days remaining** countdown shown in the sidebar banner
- **Declare winner** — once the end date passes, an admin clicks "Declare Winner & Award Banner" to resolve it
- **Permanent victory banner** — the winning department gets a 🏆 banner pinned to their row in the standings forever (stored in Firestore on the department document)
- **Rivalry history** — resolved rivalries are archived in Firestore
- Only one active rivalry at a time; an admin can cancel it at any point without awarding a banner

---

## Tournaments

Managed by admins in the Admin Panel → 🏆 Tournaments tab.

- Create named tournaments with a description and bracket type
- Add players to the tournament roster
- Track tournament matches and results
- Tournament bracket and sidebar display visible to all users

---

## Admin Panel

Accessible to admins, managers, and system admins via the ⚙️ button in the header.

### 👥 Users Tab
- Full list of all registered users with online presence indicators
- Shows name, email, rating, W/L record, account status (Active / Blocked), and role badge
- **"X online now"** count at the top
- **Actions per user:** Edit Stats, Block/Unblock, Change Role, Remove Account

### 👔 Staff Tab
- Lists all users with elevated roles (admin, manager, system admin)

### 📋 Waivers Tab
- View every user's waiver status — signed or unsigned
- See the **electronic signature** (rendered in cursive) and the date/time it was signed
- **Download** a printable PDF of any signed waiver (available to staff roles)
- Summary counts: how many users have signed vs. not signed

### 🏢 Departments Tab
- Create new departments with a name and emoji icon
- Manage department membership (add or reassign players)
- Delete departments (only if empty)

### 🏆 Tournaments Tab
- Create and manage tournament records
- Add participants and log results

### ⚔️ Rivalry Tab
- Launch a new Rivalry Week between any two departments
- Monitor the live score during an active rivalry
- Declare the winner when the rivalry period ends

### ➕ Create Tab
- Create new user accounts (email, name, temporary password, role)

---

## Badges & Achievements

Badges are permanently stored on each player's profile and displayed in the leaderboard and profile modal.

| Badge | Icon | How to earn |
|---|---|---|
| 🎆 New Year's Day | 🎆 | Played a match on January 1 |
| 💝 Valentine's Day | 💝 | Played on February 14 |
| 🍀 St. Patrick's Day | 🍀 | Played on March 17 |
| 🎇 Independence Day | 🎇 | Played on July 4 |
| 🎃 Halloween | 🎃 | Played on October 31 |
| 🎖️ Veterans Day | 🎖️ | Played on November 11 |
| ⭐ Christmas Eve | ⭐ | Played on December 24 |
| 🎄 Christmas | 🎄 | Played on December 25 |
| 🥂 New Year's Eve | 🥂 | Played on December 31 |
| 🦨 The Skunk | 🦨 | Won a game 11–0 |
| 👑 Top Dog | 👑 | Reached #1 on the individual leaderboard |
| 🏆 Team Champions | 🏆 | Your department reached #1 in team standings |
| 🌅 Early Bird | 🌅 | Played a match before 8 AM |
| 🦉 Night Owl | 🦉 | Played a match at or after 8 PM |
| 🐾 Underdog | 🐾 | Won a competitive match while your department had a losing record |

### Underdog Multiplier
When you earn the Underdog badge (or win again while your dept is still losing), you also receive a **7-day 2× multiplier** for the Pickle-Dodge mini-game. Your score is doubled at game end and the bonus is shown on the result screen.

---

## Mini-Games & Easter Eggs

### 🥒 Pickle-Dodge (header button)
A 30-second reflex mini-game launched from the 🥒 button in the header.

- Pickles, stars, and fireballs fly across the screen right-to-left
- Click them before they escape: 🥒 = 1 pt, ⭐ = 3 pts, 🔥 = 5 pts
- Large invisible padding around each target makes clicking forgiving
- Score is saved to your player profile (`pickleTotalPoints`, `pickleHighScore`)
- Points are also added to your **department's seasonal pickle total** in Firestore
- If you have an active **Underdog 2× multiplier**, your final score is doubled
- Ranks: Pickle Legend (40+), Pickle Master (25+), Pickle Pro (15+), Pickle Rookie (6+)

### 🎮 Konami Code Easter Egg
Type `↑ ↑ ↓ ↓ ← → ← → B A` on your keyboard anywhere on the page.

- Triggers a rain of 🥒 pickle and 🎉 confetti emojis falling from the top of the screen
- The interface temporarily glows neon-cyan (header, court cards, slot buttons)
- A "🥒 PICKLE MODE ACTIVATED 🥒" banner slides down from the top

### 🛡️ Department Mascots
Triple-click (three rapid clicks) on any department name in the sidebar standings.

- A popup appears with a unique mascot for that department:
  - Care → 🛡️ The Guardian
  - IT → 💻 The Debugger
  - Finance → 💰 The Accountant
  - HR → 🤝 The Handshaker
  - Operations → ⚙️ The Engineer
  - Marketing → 📣 The Hype Master
  - Legal → ⚖️ The Arbitrator
  - (others get 🏓 The Player)
- The mascot bounces in with an animation and disappears after 2.8 seconds

### 🏓 Pickle-Fi (Idle Detector)
Leave the tab open without any interaction for **1 hour**.

- A wiggling 🏓 ping-pong paddle floats onto the screen and bounces off the edges
- Shows a "Pssst… still there? 👀" speech bubble
- Click it to dismiss and reset the idle timer

---

## Active Status (Presence)

- Every logged-in user writes a `lastSeen` heartbeat to Firestore every **60 seconds**
- Users who have been seen within the last **2 minutes** are considered "Online"
- **Green dot** appears next to online users in:
  - The Admin Panel Users list (with an "X online now" count at the top)
  - The Leaderboard (dot next to the player's name)
- Presence stops when the user signs out

---

## Roles & Permissions

| Role | Description |
|---|---|
| `user` | Can reserve courts (6 AM–6 PM only), log their own match results, edit their own profile |
| `manager` | All user permissions + can reserve any hour, add/remove regular users from slots, view waivers |
| `admin` | All manager permissions + can manage users, create departments, run tournaments |
| `system_admin` | Full access — can manage admins, access all features, override any restriction |

**Waiver requirement** — all users must sign the electronic liability waiver before accessing the app.

**Password policy** — accounts with the default passwords `pickleball` or `pickleball1` are automatically forced to change their password on next login.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML/CSS/JavaScript (ES Modules) |
| Backend / Database | Firebase Firestore |
| Authentication | Firebase Auth (email/password) |
| Hosting | Firebase Hosting |
| Realtime sync | Firestore `onSnapshot` listeners |
| CSS architecture | Single `styles.css` entry point with `@import` modules |
| Firebase SDK | `firebase@10.12.0` via CDN (gstatic) |

### Key files
- `index.html` — single HTML shell; all UI is rendered by JavaScript
- `js/app.js` — entry point, imports all feature modules
- `js/auth.js` — sign-in flow, onboarding gate, presence start
- `js/schedule.js` — court grid, slot rendering, reservation logic
- `js/matches.js` — match log and edit modals
- `js/admin.js` — admin panel tabs and user management
- `js/departments.js` — department standings, conquest, rivalry display
- `js/leaderboard.js` — leaderboard modal
- `js/badges.js` — badge award logic (including underdog check)
- `js/presence.js` — heartbeat writer and `isOnline()` helper
- `js/conquest.js` — court conquest computation from match history
- `js/rivalry.js` — rivalry CRUD and admin UI
- `js/pickledodge.js` — Pickle-Dodge mini-game
- `js/easter.js` — Konami code, department mascots, Pickle-Fi idle watcher
- `firestore.rules` — security rules (field-level privilege escalation prevention)

---

*Internal use only — SafeStreets employees.*
