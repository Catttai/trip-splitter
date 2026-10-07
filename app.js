import { PEOPLE, CURRENCY, TRIP_ID } from './config.js';
import { toCents, equalShares, sharesOf, balances, settle } from './split.js';
import { openStore } from './store.js';

const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat(undefined, { style: 'currency', currency: CURRENCY });
const money = (cents) => fmt.format(cents / 100);
const DRAFT_KEY = 'trip-splitter:' + TRIP_ID + ':draft';

const form = $('form');
const f = form.elements;
let expenses = [];
let editingId = null;
let store = null;

// Form state that isn't held by a plain input.
let paidBy = '';
let mode = 'equal';
let people = [...PEOPLE];

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v != null && v !== false) node.setAttribute(k, v);
  }
  node.append(...children.flat().filter((c) => c != null));
  return node;
}

// ---------- form ----------

function pill(name, on, onclick) {
  return el('button', { type: 'button', class: 'pill', 'aria-pressed': String(on), onclick }, name);
}

function renderPills() {
  $('payer').replaceChildren(
    ...PEOPLE.map((p) => pill(p, paidBy === p, () => { paidBy = p; changed(); })),
  );
  $('split').parentElement.hidden = mode !== 'equal';
  $('split').replaceChildren(
    ...PEOPLE.map((p) =>
      pill(p, people.includes(p), () => {
        people = people.includes(p) ? people.filter((x) => x !== p) : PEOPLE.filter((x) => x === p || people.includes(x));
        changed();
      }),
    ),
  );
}

function buildCustom(values = {}) {
  $('custom').replaceChildren(
    ...PEOPLE.map((p) =>
      el(
        'label',
        { class: 'custom-row' },
        el('span', {}, p),
        el('input', { type: 'text', inputmode: 'decimal', placeholder: '0.00', 'data-person': p, value: values[p] ?? '' }),
      ),
    ),
  );
}

function customRaw() {
  const out = {};
  for (const i of $('custom').querySelectorAll('input')) out[i.dataset.person] = i.value;
  return out;
}

function customSum() {
  return Object.values(customRaw()).reduce((a, v) => a + toCents(v), 0);
}

function setMode(m, values) {
  mode = m;
  $('custom').hidden = m !== 'custom';
  $('mode').textContent = m === 'custom' ? 'Split equally' : 'Custom amounts';
  if (m === 'custom') buildCustom(values);
}

function updateHint() {
  const amount = toCents(f.amount.value);
  const hint = $('hint');
  hint.className = 'hint';
  if (mode === 'equal') {
    if (!people.length) {
      hint.textContent = 'Pick at least one person';
      hint.classList.add('bad');
    } else if (amount) {
      const each = equalShares(amount, people);
      const vals = new Set(Object.values(each));
      hint.textContent = vals.size === 1 ? `${money(each[people[0]])} each` : `About ${money(Math.round(amount / people.length))} each`;
    } else hint.textContent = '';
  } else {
    const left = amount - customSum();
    if (!amount) hint.textContent = '';
    else if (left === 0) hint.textContent = 'Adds up';
    else {
      hint.textContent = left > 0 ? `${money(left)} left` : `${money(-left)} over`;
      hint.classList.add('bad');
    }
  }
}

function changed() {
  renderPills();
  updateHint();
  $('error').textContent = '';
  saveDraft();
}

function validate() {
  const amount = toCents(f.amount.value);
  if (!f.description.value.trim()) return 'Add what it was for';
  if (!(amount > 0)) return 'Enter an amount';
  if (!paidBy) return 'Choose who paid';
  if (mode === 'equal' && !people.length) return 'Pick who to split with';
  if (mode === 'custom' && customSum() !== amount) return 'Amounts need to add up to the total';
  return '';
}

function toExpense() {
  const amount = toCents(f.amount.value);
  let split;
  if (mode === 'equal') {
    split = { mode: 'equal', people: [...people] };
  } else {
    const raw = customRaw();
    const shares = {};
    for (const p of PEOPLE) {
      const c = toCents(raw[p] || 0);
      if (c > 0) shares[p] = c;
    }
    split = { mode: 'custom', shares };
  }
  return { description: f.description.value.trim(), amount, paidBy, split };
}

function fill(s = {}) {
  f.description.value = s.description || '';
  f.amount.value = s.amountRaw || '';
  paidBy = s.paidBy || '';
  people = s.people ? PEOPLE.filter((p) => s.people.includes(p)) : [...PEOPLE];
  setMode(s.mode || 'equal', s.customRaw);
  renderPills();
  updateHint();
}

function saveDraft() {
  if (editingId) return;
  try {
    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ description: f.description.value, amountRaw: f.amount.value, paidBy, mode, people, customRaw: customRaw() }),
    );
  } catch {}
}

function loadDraft() {
  try {
    return JSON.parse(localStorage.getItem(DRAFT_KEY)) || {};
  } catch {
    return {};
  }
}

function resetForm() {
  const keep = paidBy;
  editingId = null;
  form.classList.remove('editing');
  $('submit').textContent = 'Add';
  $('cancel').hidden = $('delete').hidden = true;
  $('error').textContent = '';
  fill({ paidBy: keep });
  saveDraft();
  render();
}

function startEdit(e) {
  editingId = e.id;
  form.classList.add('editing');
  $('submit').textContent = 'Save';
  $('cancel').hidden = $('delete').hidden = false;
  $('error').textContent = '';
  const raw = {};
  if (e.split.mode === 'custom') {
    for (const [p, c] of Object.entries(e.split.shares)) raw[p] = (c / 100).toFixed(2);
  }
  fill({
    description: e.description,
    amountRaw: (e.amount / 100).toFixed(2),
    paidBy: e.paidBy,
    mode: e.split.mode,
    people: e.split.mode === 'equal' ? e.split.people : PEOPLE,
    customRaw: raw,
  });
  render();
  form.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

form.addEventListener('input', () => {
  updateHint();
  $('error').textContent = '';
  saveDraft();
});

$('mode').addEventListener('click', () => {
  if (mode === 'equal') {
    // Start custom from the equal split so only the differences need typing.
    const amount = toCents(f.amount.value);
    const start = {};
    if (amount) for (const [p, c] of Object.entries(equalShares(amount, people))) start[p] = (c / 100).toFixed(2);
    setMode('custom', start);
  } else {
    setMode('equal');
  }
  changed();
});

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const msg = validate();
  if (msg) {
    $('error').textContent = msg;
    return;
  }
  const now = Date.now();
  const exp = toExpense();
  try {
    if (editingId) {
      const old = expenses.find((x) => x.id === editingId);
      store.update(editingId, { ...exp, createdAt: old?.createdAt || now, updatedAt: now }).catch(showError);
    } else {
      // No await: the change shows locally at once and syncs in the background.
      store.add({ ...exp, createdAt: now, updatedAt: now }).catch(showError);
    }
    resetForm();
  } catch (err) {
    showError(err);
  }
});

$('cancel').addEventListener('click', resetForm);

$('delete').addEventListener('click', () => {
  const e = expenses.find((x) => x.id === editingId);
  if (!e || !confirm(`Delete "${e.description}"?`)) return;
  store.remove(e.id).catch(showError);
  resetForm();
});

function showError(err) {
  console.error(err);
  $('error').textContent = 'Could not save: ' + err.message;
}

// ---------- rendering ----------

function render() {
  const total = expenses.reduce((a, e) => a + e.amount, 0);
  const transfers = settle(balances(expenses, PEOPLE));

  $('transfers').replaceChildren(
    ...(transfers.length
      ? transfers.map((t) =>
          el(
            'li',
            {},
            el('span', {}, t.from, el('span', { class: 'muted' }, ' pays '), t.to),
            el('span', { class: 'money' }, money(t.amount)),
          ),
        )
      : [el('li', { class: 'empty' }, expenses.length ? 'All square' : 'Nothing owed yet')]),
  );
  $('total').textContent = expenses.length ? `${money(total)} spent in total` : '';

  const shown = [...expenses].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  $('expenses').replaceChildren(
    ...(shown.length ? shown.map(expenseRow) : [el('li', { class: 'empty' }, 'No expenses yet')]),
  );
}

function splitText(e) {
  if (e.split.mode === 'custom') {
    return Object.entries(sharesOf(e)).map(([p, c]) => `${p} ${money(c)}`).join(', ');
  }
  return e.split.people.length === PEOPLE.length ? '' : e.split.people.join(', ');
}

function expenseRow(e) {
  const detail = splitText(e);
  return el(
    'li',
    {},
    el(
      'button',
      { type: 'button', class: 'row' + (editingId === e.id ? ' on' : ''), onclick: () => startEdit(e) },
      el(
        'span',
        { class: 'row-main' },
        el('span', { class: 'row-title' }, e.description),
        el('span', { class: 'muted' }, 'Paid by ' + e.paidBy + (detail ? ' · for ' + detail : '')),
      ),
      el('span', { class: 'money' }, money(e.amount)),
    ),
  );
}

function setStatus(state, text) {
  const s = $('status');
  s.dataset.state = state;
  s.textContent = { live: 'Live', local: 'This device only', offline: 'Offline', saving: 'Saving', connecting: '', error: 'Not connected' }[state] ?? '';
  s.title = text;
}

// ---------- start ----------

fill(loadDraft());

store = await openStore((list) => {
  expenses = list.filter((e) => e && typeof e.amount === 'number' && e.split);
  if (editingId && !expenses.some((e) => e.id === editingId)) {
    resetForm();
    $('error').textContent = 'Someone else deleted that expense';
  }
  render();
}, setStatus);
