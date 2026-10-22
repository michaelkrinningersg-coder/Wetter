<script>
  // Eine sortierbare Tabelle: Klick auf den Spaltenkopf sortiert, ein
  // zweiter Klick dreht die Richtung. Für die Jahreslisten der Auswertungen.
  //
  // spalten: [{ key, titel, einheit?, wert?(zeile), text?(zeile), links?, farbe?(zeile) }]
  let { spalten, zeilen, start = null, absteigend: startAb = true, markiert = null, hoehe = "100%" } = $props();

  let nach = $state(start ?? spalten[0].key);
  let ab = $state(startAb);

  const wertVon = (sp, z) => (sp.wert ? sp.wert(z) : z[sp.key]);

  const sortiert = $derived.by(() => {
    const sp = spalten.find((s) => s.key === nach) ?? spalten[0];
    return [...zeilen].sort((a, b) => {
      const x = wertVon(sp, a), y = wertVon(sp, b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      const v = typeof x === "string" ? x.localeCompare(y) : x - y;
      return ab ? -v : v;
    });
  });

  function klick(key) {
    if (nach === key) ab = !ab;
    else ((nach = key), (ab = true));
  }
</script>

<div class="rollen" style:max-height={hoehe}>
  <table>
    <thead>
      <tr>
        {#each spalten as sp}
          <th class:l={sp.links} class:an={nach === sp.key} onclick={() => klick(sp.key)}>
            {sp.titel}{#if nach === sp.key}{ab ? "\u00a0▾" : "\u00a0▴"}{/if}
            {#if sp.einheit}<small>{sp.einheit}</small>{/if}
          </th>
        {/each}
      </tr>
    </thead>
    <tbody>
      {#each sortiert as z}
        <tr class:markiert={markiert && markiert(z)} class:blass={z._blass}>
          {#each spalten as sp}
            <td class:l={sp.links} class:num={!sp.links} style:color={sp.farbe ? sp.farbe(z) : null}>
              {sp.text ? sp.text(z) : (wertVon(sp, z) ?? "–")}
            </td>
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .rollen {
    overflow: auto;
    min-height: 0;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    font-size: 13px;
  }
  th {
    position: sticky;
    top: 0;
    background: var(--flaeche);
    font-size: 12px;
    font-weight: 600;
    color: var(--text-2);
    text-align: right;
    padding: 5px 8px;
    border-bottom: 1px solid var(--rand);
    cursor: pointer;
    user-select: none;
    white-space: nowrap;
  }
  th small {
    display: block;
    font-weight: 400;
    color: var(--text-3);
    font-size: 10px;
  }
  th.an {
    color: var(--akzent);
  }
  td {
    text-align: right;
    padding: 4px 8px;
    border-bottom: 1px solid var(--rand);
    white-space: nowrap;
  }
  .l {
    text-align: left;
  }
  tr.markiert td {
    background: var(--akzent-hell);
    font-weight: 600;
  }
  tr.blass td {
    color: var(--text-3);
  }
  /* Handy: enger, Köpfe dürfen umbrechen, erste Spalte bleibt beim seitlichen Rollen stehen */
  @media (max-width: 700px) {
    table {
      font-size: 12.5px;
    }
    th {
      white-space: normal;
      padding: 4px 5px;
      vertical-align: bottom;
    }
    td {
      padding: 4px 5px;
    }
    th:first-child,
    td:first-child {
      position: sticky;
      left: 0;
      background: var(--flaeche);
      z-index: 1;
    }
    th:first-child {
      z-index: 2;
    }
    tr.markiert td:first-child {
      background: var(--akzent-hell);
    }
  }
</style>
