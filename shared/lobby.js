/*
 * Lobby dialogs for the copy-paste connection flow. Pure UI around shared/p2p.js.
 */
(function (root) {
  'use strict';

  function el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else e.setAttribute(k, v);
    }
    for (const k of kids) e.append(k);
    return e;
  }

  function codeBox(label, readonly) {
    const ta = el('textarea', { rows: '4', spellcheck: 'false', placeholder: readonly ? '' : 'Paste here' });
    if (readonly) ta.readOnly = true;
    const copy = el('button', { type: 'button', text: 'Copy' });
    copy.onclick = async () => {
      try { await navigator.clipboard.writeText(ta.value); copy.textContent = 'Copied'; }
      catch (e) { ta.select(); copy.textContent = 'Select + copy'; }
      setTimeout(() => { copy.textContent = 'Copy'; }, 1500);
    };
    const wrap = el('div', { class: 'lb-code' }, el('label', { text: label }), ta);
    if (readonly) wrap.append(copy);
    return { wrap, ta };
  }

  function makeDialog(title) {
    const d = el('dialog', { class: 'lobby' });
    const close = el('button', { type: 'button', class: 'lb-x', text: 'Close' });
    close.onclick = () => d.close();
    d.append(el('h2', { text: title }));
    d.addEventListener('close', () => d.remove());
    document.body.append(d);
    return { d, close };
  }

  // net: P2P.host(). opts.onStart() is called when the host presses Start.
  function showHost(net, opts) {
    const { d, close } = makeDialog(opts.title || 'Host a game');
    const intro = el('p', { class: 'dim', text: 'Add a friend, send them the invite code, then paste back the reply code they send you. Repeat for each friend. Works over the internet, no server involved.' });
    const slots = el('div', { class: 'lb-slots' });
    const add = el('button', { type: 'button', class: 'primary', text: 'Add a friend' });
    const start = el('button', { type: 'button', class: 'primary', text: opts.startLabel || 'Start game' });
    const status = el('p', { class: 'hint' });
    start.disabled = true;

    function refresh() {
      const open = [...net.peers.values()].filter(p => p.state === 'open').length;
      start.disabled = open === 0 || !!opts.started;
      add.disabled = [...net.peers.values()].filter(p => p.state !== 'closed').length >= net.maxGuests;
    }

    add.onclick = async () => {
      add.disabled = true; status.textContent = 'Making an invite...';
      try {
        const { id, code } = await net.invite();
        status.textContent = '';
        const inv = codeBox('1. Send this invite code to your friend', true); inv.ta.value = code;
        const rep = codeBox('2. Paste their reply code here');
        const go = el('button', { type: 'button', text: 'Connect' });
        const st = el('span', { class: 'dim', text: 'waiting for reply' });
        go.onclick = async () => {
          try { st.textContent = 'connecting...'; await net.accept(id, rep.ta.value); }
          catch (e) { st.textContent = e.message; st.className = 'bad'; }
        };
        const slot = el('div', { class: 'lb-slot' }, el('b', { text: 'Friend ' + id }), ' ', st, inv.wrap, rep.wrap, go);
        slot.dataset.id = id;
        slot._st = st; slot._boxes = [inv.wrap, rep.wrap, go];
        slots.append(slot);
      } catch (e) { status.textContent = e.message; }
      refresh();
    };

    net.on('open', id => {
      const slot = slots.querySelector('[data-id="' + id + '"]');
      if (slot) { slot._st.textContent = 'connected'; slot._st.className = 'good'; slot._boxes.forEach(b => b.remove()); }
      refresh();
    });
    net.on('close', id => {
      const slot = slots.querySelector('[data-id="' + id + '"]');
      if (slot) { slot._st.textContent = 'left'; slot._st.className = 'bad'; slot._boxes.forEach(b => b.remove()); }
      refresh();
    });

    start.onclick = () => { opts.onStart(); d.close(); };
    d.append(intro, slots, status, el('div', { class: 'lb-row' }, add, start, close));
    d.showModal(); refresh();
    return d;
  }

  // net: P2P.guest(). opts.onConnected() fires when the channel opens.
  function showJoin(net, opts) {
    const { d, close } = makeDialog((opts && opts.title) || 'Join a game');
    const inv = codeBox('1. Paste the host\'s invite code');
    const make = el('button', { type: 'button', class: 'primary', text: 'Make reply code' });
    const reply = codeBox('2. Send this reply code back to the host', true);
    reply.wrap.hidden = true;
    const status = el('p', { class: 'hint' });
    make.onclick = async () => {
      make.disabled = true; status.textContent = 'Working...';
      try {
        reply.ta.value = await net.join(inv.ta.value);
        reply.wrap.hidden = false;
        status.textContent = 'Waiting for the host to connect. Keep this open.';
      } catch (e) { status.textContent = e.message; status.className = 'bad'; make.disabled = false; }
    };
    net.on('open', () => { status.textContent = 'Connected. Waiting for the host to start.'; status.className = 'good'; if (opts && opts.onConnected) opts.onConnected(d); });
    net.on('close', () => { status.textContent = 'Disconnected.'; status.className = 'bad'; });
    d.append(el('p', { class: 'dim', text: 'Paste the host\'s invite code, make a reply code, and send it back to them.' }), inv.wrap, make, reply.wrap, status, el('div', { class: 'lb-row' }, close));
    d.showModal();
    return d;
  }

  root.Lobby = { showHost, showJoin };
})(window);
