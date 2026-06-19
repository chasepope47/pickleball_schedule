import { todayDayIdx } from './utils.js';

export const state = {
  currentUser:    null,   // Firebase Auth user
  currentProfile: null,   // Firestore player document
  selectedDay:    todayDayIdx,
  pendingJoin:    null,   // { court, day, hour } from a share link
  appInitialized: false,  // guard so startSync only runs once
  data:           { 1: {}, 2: {} },  // data[court][dayIdx][hour] = reservation
  matchCache:     new Map(),          // slotKey → logged match doc for current week
};
