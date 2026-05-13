async function loadCSV(path) {
  const res = await fetch(path);
  const text = await res.text();
  // 超簡易CSVパーサ（ダブルクオート対応の簡略版）
  const lines = text.trim().split(/\r?\n/);
  const rows = lines.map(line => {
    const out = [];
    let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i], n = line[i+1];
      if (c === '"' && inQ && n === '"') { cur += '"'; i++; continue; }
      if (c === '"') { inQ = !inQ; continue; }
      if (c === ',' && !inQ) { out.push(cur); cur = ""; continue; }
      cur += c;
    }
    out.push(cur);
    return out;
  });
  return { header: rows[0], data: rows.slice(1) };
}

(async () => {
  const { header, data } = await loadCSV("data/tracks.csv");
  const tbody = document.querySelector("#trackTable tbody");
  data.forEach(row => {
    const tr = document.createElement("tr");
    const pick = (name) => row[header.indexOf(name)] || "";
    const cells = [
      pick("track_no"), pick("title"), pick("artist"), pick("dance_style"),
      pick("tempo_display"), pick("tempo_bpm"), pick("duration_sec"), pick("remarks")
    ];
    cells.forEach(txt => {
      const td = document.createElement("td");
      td.textContent = txt;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
})();
