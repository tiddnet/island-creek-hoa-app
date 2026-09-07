import { db } from "./firebase-init.js";
import {
  collection, getDocs, query, orderBy,
  doc, setDoc, onSnapshot,
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
