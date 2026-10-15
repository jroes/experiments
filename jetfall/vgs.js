/*
 * Jetfall quick chat: press V, then letters, to say a canned line (V G S is "Shazbot!").
 * Lines marked team go to your team only. The host only accepts keys from this list, so a peer
 * cannot put words in anyone's mouth with it. No DOM; the host worker loads it too.
 */
(function (root) {
  'use strict';
  const TREE = {
    G: { name: 'Global', team: false, lines: {
      S: 'Shazbot!', Y: 'Yes.', N: 'No.', H: 'Hi!', B: 'Bye.', T: 'Thanks.', O: 'Oops.', W: 'Woohoo!', A: 'Awesome!', C: 'Cease fire!' } },
    A: { name: 'Attack', team: true, lines: {
      A: 'Attack!', F: 'Go get the enemy flag!', G: 'Hit their generator!', T: 'Take out their turrets!', B: 'Attack their base!' } },
    D: { name: 'Defend', team: true, lines: {
      B: 'Defend our base!', F: 'Defend our flag!', G: 'Defend our generator!', E: 'Escort our flag carrier!' } },
    F: { name: 'Flag', team: true, lines: {
      G: 'I have the enemy flag!', S: 'Our flag is secure.', N: 'Our flag is not in the base!', R: 'Return our flag!', C: 'Cover the flag carrier!' } },
    N: { name: 'Need', team: true, lines: {
      H: 'I need help!', C: 'Cover me!', R: 'I need repairs!', E: 'Enemy in our base!' } },
    R: { name: 'Reply', team: true, lines: {
      A: 'Acknowledged.', O: 'On it!', N: 'Negative.', W: 'Wait.', S: 'Sorry.' } },
    T: { name: 'Taunt', team: false, lines: {
      1: 'Is that all you\'ve got?', 2: 'Missed me!', 3: 'Eat plasma!', 4: 'How\'d that feel?', 5: 'Learn to ski!' } },
  };
  const has = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
  // 'GS' -> { text: 'Shazbot!', team: false }, or null for anything not in the list
  function line(key) {
    if (typeof key !== 'string' || key.length !== 2) return null;
    const g = has(TREE, key[0]) ? TREE[key[0]] : null;
    if (!g || !has(g.lines, key[1])) return null;
    return { text: g.lines[key[1]], team: g.team };
  }
  const api = { TREE, line };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.JFVGS = api;
})(typeof window !== 'undefined' ? window : globalThis);
