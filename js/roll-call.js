import { db } from "./firebase-init.js";
import {
  collection, getDocs, query, orderBy,
  doc, setDoc, updateDoc, deleteField, onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

// Meeting date comes from the device clock, not a hardcoded value -- each
// calendar day gets its own shared Firestore doc, so a fresh visit on a new
// meeting date starts a clean sheet automatically, while everyone opening
// this link on the same day shares one live, synced roll call.
const today = new Date();
const isoDate = today.toLocaleDateString("en-CA"); // YYYY-MM-DD, local time
const displayDate = today.toLocaleDateString("en-US", {
  weekday: "long", year: "numeric", month: "long", day: "numeric",
});
document.getElementById("meeting-date").textContent = displayDate;

const meetingRef = doc(db, "meetings", isoDate);

const rowsEl = document.getElementById("rows");
const presentN = document.getElementById("present-n");
const quorumStatus = document.getElementById("quorum-status");
const quorumInput = document.getElementById("quorum-input");
const quorumPrintValue = document.getElementById("quorum-print-value");

const rosterSnap = await getDocs(query(collection(db, "roster"), orderBy("order")));
const roster = rosterSnap.docs.map((d) => d.data());

if (roster.length === 0) {
  rowsEl.innerHTML = '<tr><td colspan="4" class="loading">No roster data yet.</td></tr>';
} else {
  rowsEl.innerHTML = "";
  for (const r of roster) {
    const tr = document.createElement("tr");
    tr.dataset.address = r.address;
    tr.innerHTML = `
      <td class="addr">${r.address}</td>
      <td class="owner">${r.owner}</td>
      <td class="house">${r.house || "—"}</td>
      <td class="chk"><input type="checkbox" class="cb"></td>
    `;
    const cb = tr.querySelector(".cb");
    cb.addEventListener("change", () => {
      setDoc(meetingRef, { checked: { [r.address]: cb.checked } }, { merge: true });
    });
    rowsEl.appendChild(tr);
  }
}

let suppressQuorumWrite = false;
quorumInput.addEventListener("input", () => {
  if (suppressQuorumWrite) return;
  const needed = parseInt(quorumInput.value, 10) || 9;
  setDoc(meetingRef, { quorum: needed }, { merge: true });
});

document.getElementById("print-btn").addEventListener("click", () => window.print());

document.getElementById("reset-btn").addEventListener("click", () => {
  if (!confirm("Clear all check-ins for today's meeting? This affects everyone viewing this page.")) return;
  setDoc(meetingRef, { checked: {} }, { merge: true });
});

// ---- Motions & votes -------------------------------------------------------
// meetings/{date}.motions = { <id>: { text, created, votes: { <address>: "yes"|"no"|"abstain" } } }
const motionsEl = document.getElementById("motions");
let latestData = {};

document.getElementById("motion-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = document.getElementById("motion-text");
  const text = input.value.trim();
  if (!text) return;
  const id = "m" + Date.now();
  setDoc(meetingRef, { motions: { [id]: { text, created: Date.now(), votes: {} } } }, { merge: true });
  input.value = "";
});

function castVote(id, address, choice, current) {
  // Clicking the active choice clears the vote.
  const value = current === choice ? deleteField() : choice;
  updateDoc(meetingRef, { [`motions.${id}.votes.${address}`]: value });
}

function renderMotions(data) {
  const checked = data.checked || {};
  const motions = Object.entries(data.motions || {}).sort((a, b) => a[1].created - b[1].created);
  const presentOwners = roster.filter((r) => checked[r.address]);
  motionsEl.replaceChildren();
  if (motions.length === 0) {
    const p = document.createElement("p");
    p.className = "note";
    p.textContent = "No motions yet.";
    motionsEl.appendChild(p);
    return;
  }
  motions.forEach(([id, m], i) => {
    const votes = m.votes || {};
    const count = (c) => presentOwners.filter((r) => votes[r.address] === c).length;
    const yes = count("yes"), no = count("no"), abs = count("abstain");
    const pending = presentOwners.length - yes - no - abs;

    const card = document.createElement("div");
    card.className = "card motion";
    const head = document.createElement("div");
    head.className = "motion-head";
    const title = document.createElement("div");
    title.className = "motion-title";
    title.textContent = `${i + 1}. ${m.text}`;
    const tally = document.createElement("div");
    tally.className = "motion-tally";
    tally.textContent = `Yes ${yes} · No ${no} · Abstain ${abs} · Not voted ${pending}`;
    const del = document.createElement("button");
    del.className = "reset motion-del";
    del.textContent = "Remove";
    del.addEventListener("click", () => {
      if (!confirm("Remove this motion and its votes for everyone?")) return;
      updateDoc(meetingRef, { [`motions.${id}`]: deleteField() });
    });
    head.append(title, tally, del);
    card.appendChild(head);

    const list = document.createElement("div");
    list.className = "vote-list";
    if (presentOwners.length === 0) {
      list.textContent = "Check owners present above to enable voting.";
    }
    for (const r of presentOwners) {
      const row = document.createElement("div");
      row.className = "vote-row";
      const who = document.createElement("span");
      who.className = "vote-who";
      who.textContent = `${r.address} — ${r.owner}`;
      row.appendChild(who);
      const btns = document.createElement("span");
      btns.className = "vote-btns";
      for (const c of ["yes", "no", "abstain"]) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "vote-btn " + c + (votes[r.address] === c ? " on" : "");
        b.textContent = c === "abstain" ? "Abstain" : c[0].toUpperCase() + c.slice(1);
        b.addEventListener("click", () => castVote(id, r.address, c, votes[r.address]));
        btns.appendChild(b);
      }
      row.appendChild(btns);
      list.appendChild(row);
    }
    card.appendChild(list);
    motionsEl.appendChild(card);
  });
}

// Live render -- fires immediately with current data, then again on every
// change from any device with this page open.
onSnapshot(meetingRef, (snap) => {
  const data = snap.data() || {};
  const checked = data.checked || {};
  const quorum = data.quorum || 9;

  suppressQuorumWrite = true;
  if (document.activeElement !== quorumInput) quorumInput.value = quorum;
  suppressQuorumWrite = false;

  let present = 0;
  for (const r of roster) {
    const isChecked = !!checked[r.address];
    if (isChecked) present++;
    const tr = rowsEl.querySelector(`tr[data-address="${CSS.escape(r.address)}"]`);
    if (!tr) continue;
    tr.classList.toggle("present", isChecked);
    const cb = tr.querySelector(".cb");
    if (cb && cb !== document.activeElement) cb.checked = isChecked;
  }

  latestData = data;
  renderMotions(data);

  presentN.textContent = present;
  quorumPrintValue.textContent = quorum;
  if (present >= quorum) {
    quorumStatus.textContent = "quorum met";
    quorumStatus.className = "quorum-status met";
  } else {
    quorumStatus.textContent = `quorum not met (${quorum - present} short)`;
    quorumStatus.className = "quorum-status not-met";
  }
});
