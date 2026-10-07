// Pure money logic. All amounts are integer cents to avoid rounding drift.

export function toCents(text) {
  const n = Number(String(text).replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

// Equal split: spread leftover cents over the first few people so shares
// always add up exactly to the total.
export function equalShares(amount, people) {
  const shares = {};
  if (!people.length) return shares;
  const base = Math.floor(amount / people.length);
  let extra = amount - base * people.length;
  for (const p of people) {
    shares[p] = base + (extra > 0 ? 1 : 0);
    if (extra > 0) extra--;
  }
  return shares;
}

export function sharesOf(expense) {
  if (expense.split?.mode === 'custom') return { ...expense.split.shares };
  return equalShares(expense.amount, expense.split?.people || []);
}

// Per person: what they paid, what their share of everything is, and the net.
// Positive net = others owe them; negative = they owe.
export function balances(expenses, people) {
  const out = {};
  for (const p of people) out[p] = { paid: 0, share: 0, net: 0 };
  for (const e of expenses) {
    if (out[e.paidBy]) out[e.paidBy].paid += e.amount;
    const shares = sharesOf(e);
    for (const [p, c] of Object.entries(shares)) {
      if (out[p]) out[p].share += c;
    }
  }
  for (const p of people) out[p].net = out[p].paid - out[p].share;
  return out;
}

// Fewest-ish transfers: repeatedly match the biggest debtor with the
// biggest creditor.
export function settle(bal) {
  const debtors = [];
  const creditors = [];
  for (const [p, b] of Object.entries(bal)) {
    if (b.net < 0) debtors.push({ p, amt: -b.net });
    else if (b.net > 0) creditors.push({ p, amt: b.net });
  }
  const transfers = [];
  while (debtors.length && creditors.length) {
    debtors.sort((a, b) => b.amt - a.amt);
    creditors.sort((a, b) => b.amt - a.amt);
    const d = debtors[0];
    const c = creditors[0];
    const amt = Math.min(d.amt, c.amt);
    transfers.push({ from: d.p, to: c.p, amount: amt });
    d.amt -= amt;
    c.amt -= amt;
    if (!d.amt) debtors.shift();
    if (!c.amt) creditors.shift();
  }
  return transfers;
}
