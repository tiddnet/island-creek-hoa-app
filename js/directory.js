import { db } from "./firebase-init.js";
import {
  collection, getDocs, query, orderBy,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const rowsEl = document.getElementById("rows");

const snap = await getDocs(query(collection(db, "roster"), orderBy("order")));

if (snap.empty) {
  rowsEl.innerHTML = '<tr><td colspan="3" class="loading">No roster data yet.</td></tr>';
} else {
  rowsEl.innerHTML = "";
  snap.forEach((doc) => {
    const r = doc.data();
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="addr">${r.address}</td>
      <td class="owner">${r.owner}</td>
      <td class="house">${r.house || "—"}</td>
    `;
    rowsEl.appendChild(tr);
  });
}
