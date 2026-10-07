import { PEOPLE, CURRENCY, TRIP_ID } from './config.js';
import { toCents, equalShares, sharesOf, balances, settle } from './split.js';
import { openStore } from './store.js';

const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat(undefined, { style: 'currency', currency: CURRENCY });
const money = (cents) => fmt.format(cents / 100);
const DRAFT_KEY = 'trip-splitter:' + TRIP_ID + ':draft';

const form = $('form');
let expenses = [];
let editingId = null;
let filter = 'All';
let store = null;

// ---------- small DOM helper ----------

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, '');
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c != null) node.append(c);
  }
  return node;
}

function today() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function prettyDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

// ---------- form ----------

function buildPayer() {
  $('payer').replaceChildren(
    ...PEOPLE.map((p) =>
      el('label', {}, el('input', { type: 'radio', name: 'paidBy', value: p }), el('span', {}, p)),
    ),
  );
}

function mode() {
  return form.elements.mode.value;
}

function buildSplit(state = {}) {
  const box = $('split');
  if (mode() === 'equal') {
    const people = state.people || PEOPLE;
    box.replaceChildren(
      ...PEOPLE.map((p) =>
        el(
          'label',
          { class: 'split-row' },
          el('input', { type: 'checkbox', name: 'eq', value: p, checked: people.includes(p) }),
          el('span', { class: 'name' }, p),
          el('span', { class: 'amt', 'data-for': p }),
        ),
      ),
    );
  } else {
    const shares = state.shares || {};
    box.replaceChildren(
      ...PEOPLE.map((p) =>
        el(
          'label',
          { class: 'split-row' },
          el('span', { class: 'name' }, p),
          el('input', {
            type: 'text',
            inputmode: 'decimal',
            name: 'cs',
            'data-person': p,
            placeholder: '0.00',
            value: shares[p] ?? '',
          }),
        ),
      ),
    );
  }
  updateSplitHint();
}

function readForm() {
  const f = form.elements;
  const amount = toCents(f.amount.value);
  const people = [...form.querySelectorAll('input[name=eq]:checked')].map((i) => i.value);
  const customRaw = {};
  for (const i of form.querySelectorAll('input[name=cs]')) customRaw[i.dataset.person] = i.value;
  return {
    description: f.description.value.trim(),
    amountRaw: f.amount.value,
    amount,
    date: f.date.value,
    paidBy: f.paidBy.value,
    mode: mode(),
    people,
    customRaw,
  };
}

function updateSplitHint() {
  const s = readForm();
  const hint = $('split-hint');
  hint.classList.remove('bad', 'good');
  if (s.mode === 'equal') {
    const shares = equalShares(s.amount, s.people);
    for (const span of form.querySelectorAll('.amt')) {
      const c = shares[span.dataset.for];
      span.textContent = c != null && s.amount ? money(c) : '';
    }
    hint.textContent = s.people.length
      ? `Split ${s.people.length} way${s.people.length > 1 ? 's' : ''}.`
      : 'Pick at least one person.';
    if (!s.people.length) hint.classList.add('bad');
  } else {
    const sum = Object.values(s.customRaw).reduce((a, v) => a + toCents(v), 0);
    const left = s.amount - sum;
    if (!s.amount) hint.textContent = 'Enter the total amount first.';
    else if (left === 0) {
      hint.textContent = 'Adds up to the total.';
      hint.classList.add('good');
    } else if (left > 0) {
      hint.textContent = `${money(left)} left to assign.`;
      hint.classList.add('bad');
    } else {
      hint.textContent = `${money(-left)} over the total.`;
      hint.classList.add('bad');
    }
  }
}

function validate(s) {
  if (!s.description) return 'Add a short description.';
  if (!(s.amount > 0)) return 'Enter an amount greater than zero.';
  if (!s.date) return 'Pick a date.';
  if (!s.paidBy) return 'Choose who paid.';
  if (s.mode === 'equal' && !s.people.length) return 'Pick at least one person to split with.';
  if (s.mode === 'custom') {
    const sum = Object.values(s.customRaw).reduce((a, v) => a + toCents(v), 0);
    if (sum !== s.amount) return 'Custom amounts must add up to the total.';
  }
  return '';
}

function toExpense(s) {
  let split;
  if (s.mode === 'equal') {
    split = { mode: 'equal', people: PEOPLE.filter((p) => s.people.includes(p)) };
  } else {
    const shares = {};
    for (const p of PEOPLE) {
      const c = toCents(s.customRaw[p] || 0);
      if (c > 0) shares[p] = c;
    }
    split = { mode: 'custom', shares };
  }
  return { description: s.description, amount: s.amount, date: s.date, paidBy: s.paidBy, split };
}

function fillForm(state) {
  const f = form.elements;
  f.description.value = state.description || '';
  f.amount.value = state.amountRaw || '';
  f.date.value = state.date || today();
  for (const r of form.querySelectorAll('input[name=paidBy]')) r.checked = r.value === state.paidBy;
  for (const r of form.querySelectorAll('input[name=mode]')) r.checked = r.value === (state.mode || 'equal');
  buildSplit({ people: state.people, shares: state.customRaw });
}

function saveDraft() {
  if (editingId) return;
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(readForm()));
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
  const keepPayer = form.elements.paidBy.value;
  editingId = null;
  $('form-h').textContent = 'Add an expense';
  $('submit').textContent = 'Add expense';
  $('cancel').hidden = true;
  $('error').textContent = '';
  fillForm({ paidBy: keepPayer });
  saveDraft();
}

function startEdit(e) {
  editingId = e.id;
  $('form-h').textContent = 'Edit expense';
  $('submit').textContent = 'Save changes';
  $('cancel').hidden = false;
  $('error').textContent = '';
  const customRaw = {};
  if (e.split.mode === 'custom') {
    for (const [p, c] of Object.entries(e.split.shares)) customRaw[p] = (c / 100).toFixed(2);
  }
  fillForm({
    description: e.description,
    amountRaw: (e.amount / 100).toFixed(2),
    date: e.date,
    paidBy: e.paidBy,
    mode: e.split.mode,
    people: e.split.mode === 'equal' ? e.split.people : PEOPLE,
    customRaw,
  });
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

form.addEventListener('input', (ev) => {
  if (ev.target.name === 'mode') {
    // Switching to custom: prefill with the equal split as a starting point.
    const s = readForm();
    const shares = {};
    if (ev.target.value === 'custom' && s.amount) {
      for (const [p, c] of Object.entries(equalShares(s.amount, s.people))) shares[p] = (c / 100).toFixed(2);
    }
    buildSplit({ shares });
  } else {
    updateSplitHint();
  }
  $('error').textContent = '';
  saveDraft();
});

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const s = readForm();
  const msg = validate(s);
  if (msg) {
    $('error').textContent = msg;
    return;
  }
  const now = Date.now();
  const exp = toExpense(s);
  const btn = $('submit');
  btn.disabled = true;
  try {
    if (editingId) {
      const old = expenses.find((x) => x.id === editingId);
      await store.update(editingId, { ...exp, createdAt: old?.createdAt || now, updatedAt: now });
    } else {
      // Don't wait for the server: Firestore applies it locally right away.
      store.add({ ...exp, createdAt: now, updatedAt: now }).catch(showSaveError);
    }
    resetForm();
  } catch (err) {
    showSaveError(err);
  } finally {
    btn.disabled = false;
  }
});

function showSaveError(err) {
  console.error(err);
  $('error').textContent = 'Could not save: ' + err.message;
}

$('cancel').addEventListener('click', resetForm);

// ---------- rendering ----------

function render() {
  const bal = balances(expenses, PEOPLE);
  const total = expenses.reduce((a, e) => a + e.amount, 0);
  $('total').textContent = expenses.length ? `${money(total)} total` : '';

  const transfers = settle(bal);
  $('transfers').replaceChildren(
    ...(transfers.length
      ? transfers.map((t) =>
          el(
            'li',
            {},
            el('span', {}, el('strong', {}, t.from), ' pays ', el('strong', {}, t.to)),
            el('span', { class: 'money' }, money(t.amount)),
          ),
        )
      : [el('li', { class: 'empty' }, expenses.length ? 'Everyone is square.' : 'No expenses yet. Add the first one below.')]),
  );

  $('balances').replaceChildren(
    ...PEOPLE.map((p) => {
      const b = bal[p];
      const cls = b.net > 0 ? 'pos' : b.net < 0 ? 'neg' : '';
      const net = b.net > 0 ? 'gets back ' + money(b.net) : b.net < 0 ? 'owes ' + money(-b.net) : 'even';
      return el(
        'tr',
        {},
        el('td', {}, p),
        el('td', { class: 'num' }, money(b.paid)),
        el('td', { class: 'num' }, money(b.share)),
        el('td', { class: 'num ' + cls }, net),
      );
    }),
  );

  $('filters').replaceChildren(
    ...['All', ...PEOPLE].map((p) =>
      el(
        'button',
        {
          type: 'button',
          class: 'chip' + (filter === p ? ' on' : ''),
          'aria-pressed': String(filter === p),
          onclick: () => {
            filter = p;
            render();
          },
        },
        p,
      ),
    ),
  );

  const shown = expenses
    .filter((e) => filter === 'All' || e.paidBy === filter)
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || 0) - (a.createdAt || 0));

  $('expenses').replaceChildren(
    ...(shown.length
      ? shown.map(expenseRow)
      : [el('li', { class: 'empty' }, filter === 'All' ? 'Nothing here yet.' : `Nothing paid by ${filter} yet.`)]),
  );
}

function splitText(e) {
  if (e.split.mode === 'custom') {
    return 'Custom: ' + Object.entries(sharesOf(e)).map(([p, c]) => `${p} ${money(c)}`).join(', ');
  }
  const ppl = e.split.people;
  if (ppl.length === PEOPLE.length) return `Split ${ppl.length} ways`;
  return 'Split between ' + ppl.join(', ');
}

function expenseRow(e) {
  return el(
    'li',
    { class: editingId === e.id ? 'editing' : '' },
    el(
      'div',
      { class: 'exp-main' },
      el('div', { class: 'exp-title' }, el('span', {}, e.description), el('span', { class: 'money' }, money(e.amount))),
      el('div', { class: 'exp-meta' }, `${prettyDate(e.date)} · Paid by ${e.paidBy}`),
      el('div', { class: 'exp-meta' }, splitText(e)),
    ),
    el(
      'div',
      { class: 'exp-actions' },
      el('button', { type: 'button', class: 'link', onclick: () => startEdit(e) }, 'Edit'),
      el(
        'button',
        {
          type: 'button',
          class: 'link danger',
          onclick: async () => {
            if (!confirm(`Delete "${e.description}"?`)) return;
            if (editingId === e.id) resetForm();
            try {
              await store.remove(e.id);
            } catch (err) {
              alert('Could not delete: ' + err.message);
            }
          },
        },
        'Delete',
      ),
    ),
  );
}

function setStatus(state, text) {
  const s = $('status');
  s.dataset.state = state;
  s.textContent = text;
}

// ---------- start ----------

buildPayer();
fillForm(loadDraft());

store = await openStore((list) => {
  expenses = list.filter((e) => e && typeof e.amount === 'number' && e.split);
  if (editingId && !expenses.some((e) => e.id === editingId)) {
    resetForm();
    $('error').textContent = 'That expense was deleted by someone else.';
  }
  render();
}, setStatus);
